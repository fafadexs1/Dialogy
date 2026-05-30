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

  it('lists contracts when the customer asks which contracts they have', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '13416',
              planDescription: 'PLANO PROMOCIONAL 500MEGA',
              connectionStatus: 'offline',
              statusLabel: 'Suspenso',
            },
            {
              id: '24123',
              planDescription: 'PLANO 1000 MEGA',
              connectionStatus: 'online',
              statusLabel: 'Ativo',
            },
          ],
          invoiceGroups: [],
          onlineContracts: 1,
          overdueInvoices: 1,
          openInvoices: 0,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Quais sao meus contratos?');

    expect(response).toContain('Encontrei 2 contrato');
    expect(response).toContain('Contrato 13416');
    expect(response).toContain('PLANO 1000 MEGA');
    expect(response).not.toContain('fatura');
  });

  it('returns requested payment artifacts from open invoices instead of a generic account summary', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              planDescription: 'PLANO_500MEGA_WIFI5',
              connectionStatus: 'online',
              statusLabel: 'Ativo',
            },
          ],
          invoices: [
            {
              id: '886081',
              contractId: '15532',
              amount: 54.95,
              dueDate: '2026-06-10',
              status: 'aberto',
              isOpen: true,
              pixCode: 'PIX_886081',
              paymentLink: 'https://example.test/boleto/886081',
            },
            {
              id: '886082',
              contractId: '15532',
              amount: 54.95,
              dueDate: '2026-07-10',
              status: 'aberto',
              isOpen: true,
              pixCode: 'PIX_886082',
              paymentLink: 'https://example.test/boleto/886082',
            },
          ],
          invoiceGroups: [],
          onlineContracts: 1,
          overdueInvoices: 0,
          openInvoices: 2,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(
      results,
      'Pode me informar o PIX dessas duas faturas em aberto?'
    );

    expect(response).toContain('2 faturas em aberto');
    expect(response).toContain('PIX copia e cola: PIX_886081');
    expect(response).toContain('PIX copia e cola: PIX_886082');
    expect(response).not.toContain('Contrato principal');
  });

  it('does not send payment artifacts when the customer only asks whether invoices are open', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              planDescription: 'PLANO_500MEGA_WIFI5',
              connectionStatus: 'online',
            },
          ],
          invoices: [
            {
              id: '886081',
              amount: 54.95,
              dueDate: '2026-06-10',
              status: 'aberto',
              isOpen: true,
              pixCode: 'PIX_886081',
              paymentLink: 'https://example.test/boleto/886081',
              digitableLine: '03399.03106 29900.000034 32850.301014 1 14730000005495',
            },
          ],
          onlineContracts: 1,
          overdueInvoices: 0,
          openInvoices: 1,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Tem alguma fatura em aberto?');

    expect(response).toContain('Ha 1 fatura em aberto.');
    expect(response).not.toContain('PIX copia e cola');
    expect(response).not.toContain('Link de pagamento');
    expect(response).not.toContain('Linha digitavel');
  });

  it('returns digitable lines when specifically requested', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          invoices: [
            {
              id: '886081',
              amount: 54.95,
              dueDate: '2026-06-10',
              status: 'aberto',
              isOpen: true,
              digitableLine: '03399.03106 29900.000034 32850.301014 1 14730000005495',
            },
          ],
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Preciso da linha digitavel dos boletos em aberto');

    expect(response).toContain('Linha digitavel: 03399.03106');
  });

  it('does not substitute a different payment artifact when the requested PIX is missing', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          invoices: [
            {
              id: '886081',
              amount: 54.95,
              dueDate: '2026-06-10',
              status: 'aberto',
              isOpen: true,
              paymentLink: 'https://example.test/boleto/886081',
              digitableLine: '03399.03106 29900.000034 32850.301014 1 14730000005495',
            },
          ],
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Me manda o PIX da fatura em aberto');

    expect(response).toContain('nao vieram com o dado de pagamento solicitado');
    expect(response).not.toContain('Link de pagamento');
    expect(response).not.toContain('Linha digitavel');
  });

  it('answers the address of the primary contract when requested', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              planDescription: 'PLANO_500MEGA_WIFI5',
              connectionStatus: 'online',
              addressLabel: 'QUADRA 02 CHACARA 07 BLOCO 22 APT 101 - CHACARAS BRASIL - VALPARAISO DE GOIAS - GO',
            },
          ],
          onlineContracts: 1,
          overdueInvoices: 0,
          openInvoices: 2,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Qual endereco deste meu contrato?');

    expect(response).toContain('contrato 15532');
    expect(response).toContain('QUADRA 02 CHACARA 07');
    expect(response).not.toContain('Ha 2 fatura');
  });

  it('answers the address of a specifically requested contract', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '111',
              connectionStatus: 'online',
              addressLabel: 'Endereco do contrato 111',
            },
            {
              id: '222',
              connectionStatus: 'offline',
              addressLabel: 'Endereco do contrato 222',
            },
          ],
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Qual endereco do contrato 222?');

    expect(response).toContain('contrato 222');
    expect(response).toContain('Endereco do contrato 222');
    expect(response).not.toContain('Endereco do contrato 111');
  });

  it('answers operational fields from the contract payload', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              planDescription: 'PLANO_500MEGA_WIFI5',
              connectionStatus: 'online',
              ip: '192.0.2.10',
              login: 'cliente15532',
              cto: 'CTO-12 - Porta 3',
            },
          ],
        },
      },
    ];

    expect(buildSgpResponseFromToolResults(results, 'Qual o IP do meu contrato?')).toContain('192.0.2.10');
    expect(buildSgpResponseFromToolResults(results, 'Qual login do contrato 15532?')).toContain('cliente15532');
    expect(buildSgpResponseFromToolResults(results, 'Qual CTO deste contrato?')).toContain('CTO-12 - Porta 3');
  });

  it('answers invoice fields from payable invoice payloads', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          invoices: [
            {
              id: '886081',
              amount: 54.95,
              correctedAmount: 55.25,
              dueDate: '2026-06-10',
              status: 'aberto',
              isOpen: true,
            },
          ],
        },
      },
    ];

    const dueDateResponse = buildSgpResponseFromToolResults(results, 'Qual o vencimento da fatura em aberto?');
    const amountResponse = buildSgpResponseFromToolResults(results, 'Qual o valor da fatura em aberto?');

    expect(dueDateResponse).toContain('10/06/2026');
    expect(amountResponse).toContain('55.25');
  });

  it('can answer safe custom payload keys by their requested field name', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              connectionStatus: 'online',
              customReference: 'REF-ABC-123',
            },
          ],
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Qual customReference do meu contrato?');

    expect(response).toContain('REF-ABC-123');
  });

  it('does not expose provider name or plan in the generic lookup summary', () => {
    const results: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [
            {
              id: '15532',
              planDescription: 'PLANO_500MEGA_WIFI5',
              connectionStatus: 'online',
            },
          ],
          onlineContracts: 1,
          overdueInvoices: 0,
          openInvoices: 2,
        },
      },
    ];

    const response = buildSgpResponseFromToolResults(results, 'Pode verificar meu contrato?');

    expect(response).toContain('Consultei seu cadastro no sistema.');
    expect(response).toContain('Encontrei 1 contrato online.');
    expect(response).toContain('Como posso te ajudar?');
    expect(response).not.toContain('fatura');
    expect(response).not.toContain('SGP');
    expect(response).not.toContain('PLANO_500MEGA_WIFI5');
    expect(response).not.toContain('Contrato principal');
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
