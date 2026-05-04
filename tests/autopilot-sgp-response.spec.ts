import { describe, expect, it } from 'vitest';

import {
  buildMcpCustomerResponseFromToolResults,
  buildRouterRebootActionFromSgpResults,
  buildSgpResponseFromToolResults,
  buildToolFailureResponse,
  ensurePromisedSgpLookupAction,
  ensureProcedureSgpLookupAction,
  extractRequestedContractId,
} from '@/services/autopilot-sgp-response';
import type { AgentToolExecutionResult } from '@/services/agent-tools/types';

describe('autopilot SGP response guard', () => {
  it('extracts the contract explicitly cited by the customer', () => {
    expect(extractRequestedContractId('No contrato 24123 nao tem pendencia financeira.')).toBe('24123');
    expect(extractRequestedContractId('O contrato em questao seria o 24123, preciso reiniciar o mesmo.')).toBe('24123');
  });

  it('injects an SGP lookup when the AI promises to verify operational status', () => {
    const actions = ensurePromisedSgpLookupAction({
      response: 'Vou verificar agora mesmo o status desse contrato no sistema.',
      customerMessage: 'No contrato 24123 nao tem pendencia financeira.',
      actions: [],
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
    });

    expect(actions[0]).toMatchObject({ type: 'sgp_fetch_contact_panel_data' });
  });

  it('answers using the cited contract financial status instead of a different contract debt', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '401',
              planDescription: 'Contrato antigo',
              connectionStatus: 'offline',
              statusLabel: 'Suspenso',
            },
            {
              id: '24123',
              planDescription: 'PLANO_PROMOCIONAL_300MEGA_2023',
              connectionStatus: 'online',
              statusLabel: 'Ativo',
            },
          ],
          invoiceGroups: [
            {
              key: '401',
              contractId: '401',
              contract: { id: '401', connectionStatus: 'offline', statusLabel: 'Suspenso' },
              summary: { overdueInvoices: 4, openInvoices: 1 },
            },
            {
              key: '24123',
              contractId: '24123',
              contract: { id: '24123', connectionStatus: 'online', statusLabel: 'Ativo' },
              summary: { overdueInvoices: 0, openInvoices: 0 },
            },
          ],
          onlineContracts: 1,
          overdueInvoices: 4,
          openInvoices: 1,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'No contrato 24123 nao tem pendencia financeira.');

    expect(response).toContain('contrato 24123');
    expect(response).toContain('Nao encontrei faturas vencidas nem em aberto nesse contrato.');
    expect(response).not.toContain('4 fatura');
  });

  it('does not expose raw MCP errors as customer-facing responses', () => {
    const response = buildToolFailureResponse(
      [
        {
          toolName: 'mcp:server:reboot_router',
          status: 'error',
          input: {
            type: 'mcp_call_tool',
            payload: {
              toolName: 'mcp:server:reboot_router',
              arguments: { client_ip: '192.0.2.10' },
            },
          },
          error: 'json: cannot unmarshal string into Go value',
        },
      ],
      'json: cannot unmarshal string into Go value'
    );

    expect(response).toContain('Nao consegui concluir a acao tecnica automaticamente');
    expect(response).not.toContain('json:');
  });

  it('forces SGP lookup when router reboot procedure is detected but the model returns no actions', () => {
    const actions = ensureProcedureSgpLookupAction({
      response: 'Vou realizar a reinicializacao do seu roteador agora mesmo.',
      customerMessage: 'O contrato em questao seria o 24123, preciso reiniciar o mesmo.',
      actions: [],
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      knowledgeToolProcedures: 'Tool resolvida: mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
    });

    expect(actions[0]).toMatchObject({ type: 'sgp_fetch_contact_panel_data' });
  });

  it('builds reboot_router action with the IPv4 from the requested SGP contract', () => {
    const action = buildRouterRebootActionFromSgpResults({
      customerMessage: 'O contrato em questao seria o 24123, preciso reiniciar o mesmo.',
      response: 'Vou realizar a reinicializacao do seu roteador agora mesmo.',
      knowledgeToolProcedures: 'Tool resolvida: mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: {
            contracts: [
              { id: '111', ip: '10.0.0.1', connectionStatus: 'online' },
              { id: '24123', ip: '192.145.213.14', connectionStatus: 'online' },
            ],
          },
        },
      ],
    });

    expect(action).toMatchObject({
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
        arguments: {
          client_ip: '192.145.213.14',
        },
      },
    });
  });

  it('returns a friendly customer response after reboot_router succeeds', () => {
    const response = buildMcpCustomerResponseFromToolResults([
      {
        toolName: 'mcp:server:reboot_router',
        status: 'success',
        input: {
          type: 'mcp_call_tool',
          payload: {
            toolName: 'mcp:server:reboot_router',
            arguments: { client_ip: '192.145.213.14' },
          },
        },
        output: { content: [{ type: 'text', text: '{"status":"enqueued"}' }] },
      },
    ]);

    expect(response).toContain('enviei o comando de reinicializacao');
    expect(response).not.toContain('enqueued');
  });
});
