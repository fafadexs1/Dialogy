import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { Contact } from '@/lib/types';

const team: ToolRouterTeam = {
  id: 'team-support',
  name: 'Suporte',
  routingConfig: { enabled: true, autoTransfer: true },
};

const contact: Contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: 'Cliente Teste',
};

function validate(input: {
  message: string;
  response: string | null;
  plannedActions?: AgentToolAction[];
  toolResults?: AgentToolExecutionResult[];
  enabledToolNames?: string[];
  contactOverride?: Contact;
}) {
  const resolvedContact = input.contactOverride || contact;
  const intentResolution = resolveAutopilotIntent({ customerMessage: input.message });
  return validateAutopilotResponse({
    response: input.response,
    fallbackReply: 'Fallback configurado.',
    customerMessage: input.message,
    intentResolution,
    slotExtraction: extractAutopilotSlots({
      customerMessage: input.message,
      contact: resolvedContact,
    }),
    plannedActions: input.plannedActions || [],
    toolResults: input.toolResults || [],
    enabledToolNames: input.enabledToolNames || ['transfer_chat', 'add_internal_note'],
    availableTeams: [team],
    contact: resolvedContact,
    knowledgeCoverage: 'medium',
    source: 'llm',
  });
}

describe('autopilot response validator', () => {
  it('approves a normal safe response', () => {
    const result = validate({
      message: 'Quero conhecer os servicos',
      response: 'Temos algumas opcoes. Qual tipo de servico voce procura?',
    });

    expect(result.decision).toBe('approve');
    expect(result.response).toContain('opcoes');
  });

  it('replaces empty responses with configured fallback', () => {
    const result = validate({
      message: 'Oi',
      response: '',
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.response).toBe('Fallback configurado.');
  });

  it('replaces internal JSON/tool leaks with fallback', () => {
    const result = validate({
      message: 'Preciso de suporte',
      response: '{"response":"ok","actions":[{"type":"sgp_fetch_contact_panel_data","payload":{}}]}',
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.reasons).toContain('internal_or_technical_leak');
  });

  it('asks for CPF/CNPJ when response promises lookup but required slot is missing', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto',
      response: 'Vou consultar sua fatura no sistema.',
    });

    expect(result.decision).toBe('repair');
    expect(result.response).toContain('CPF/CNPJ');
  });

  it('handoffs when response promises lookup without tool or missing slot path', () => {
    const result = validate({
      message: 'Voce consegue verificar disponibilidade?',
      response: 'Vou verificar a disponibilidade no sistema.',
    });

    expect(result.decision).toBe('handoff');
    expect(result.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('approves lookup success claim when a lookup tool succeeded', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      response: 'Consultei o cadastro no sistema e encontrei uma fatura em aberto.',
      plannedActions: [{ type: 'sgp_fetch_contact_panel_data', reason: 'Consulta', payload: {} }],
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: { invoices: [{ id: '1' }] },
        },
      ],
    });

    expect(result.decision).toBe('approve');
  });

  it('replaces lookup success claim when the lookup tool failed', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      response: 'Consultei o cadastro no sistema e encontrei uma fatura em aberto.',
      plannedActions: [{ type: 'sgp_fetch_contact_panel_data', reason: 'Consulta', payload: {} }],
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'error',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          error: 'timeout',
        },
      ],
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.response).toContain('Nao consegui concluir a consulta');
  });

  it('adds handoff action when response promises transfer without transfer action', () => {
    const result = validate({
      message: 'Estou com problema no acesso',
      response: 'Vou encaminhar para a equipe responsavel.',
    });

    expect(result.decision).toBe('handoff');
    expect(result.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('adds close_chat action when response promises closure without action', () => {
    const result = validate({
      message: 'pode encerrar o atendimento',
      response: 'Atendimento encerrado conforme solicitado.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(result.decision).toBe('repair');
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
    expect((result.actions[0] as any).payload.sendCloseMessage).toBe(false);
  });

  it('repairs first-person closure claims without close action', () => {
    const result = validate({
      message: 'Encerra ai',
      response: 'Compreendido, Fabricio. Finalizei o atendimento por aqui, conforme solicitado.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(result.decision).toBe('repair');
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
  });
});
