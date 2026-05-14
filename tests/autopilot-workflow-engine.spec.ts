import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { resolveAutopilotWorkflowPlan } from '@/services/autopilot/workflow-engine';
import type { Contact } from '@/lib/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';

const contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: 'Cliente Teste',
} satisfies Contact;

const supportTeam = {
  id: 'team-support',
  name: 'Suporte',
  routingConfig: { enabled: true, autoTransfer: true },
} satisfies ToolRouterTeam;

function planFor(input: {
  message: string;
  enabledToolNames?: string[];
  teams?: ToolRouterTeam[];
  contactOverride?: Contact;
  knowledgeCoverage?: 'high' | 'medium' | 'low' | 'none';
  closeIntentGate?: {
    execute: boolean;
    confidence: 'low' | 'medium' | 'high';
    reason?: string | null;
  } | null;
}) {
  const intentResolution = resolveAutopilotIntent({ customerMessage: input.message });
  return resolveAutopilotWorkflowPlan({
    intentResolution,
    customerMessage: input.message,
    contact: input.contactOverride || contact,
    enabledToolNames: input.enabledToolNames || ['transfer_chat', 'add_internal_note'],
    availableTeams: input.teams || [supportTeam],
    knowledgeCoverage: input.knowledgeCoverage || 'low',
    slotMappings: { customerIdentifierFieldKeys: ['cpf-field-id'] },
    closeIntentGate: input.closeIntentGate,
    now: new Date(2026, 4, 5),
  });
}

describe('autopilot workflow engine', () => {
  it('handles explicit human handoff without LLM', () => {
    const plan = planFor({
      message: 'Quero falar com um atendente humano',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.response).toContain('equipe Suporte');
    expect(plan.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('closes the chat when the customer explicitly asks to end the atendimento', () => {
    const plan = planFor({
      message: 'Nao gostei de nenhum dos planos, pode encerrar',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.response).toContain('encerrado');
    expect(plan.actions.map((action) => action.type)).toEqual(['close_chat']);
    expect((plan.actions[0] as any).payload.sendCloseMessage).toBe(false);
  });

  it('closes the chat for short colloquial close requests', () => {
    const plan = planFor({
      message: 'Encerra ai',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('uses the close intent gate for ambiguous close requests', () => {
    const plan = planFor({
      message: 'ja deu por aqui',
      enabledToolNames: ['close_chat', 'add_internal_note'],
      closeIntentGate: {
        execute: true,
        confidence: 'medium',
        reason: 'Cliente indicou que quer terminar a conversa.',
      },
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('does not confuse contract cancellation with chat close', () => {
    const plan = planFor({
      message: 'Quero encerrar meu contrato de internet',
      enabledToolNames: ['close_chat', 'transfer_chat', 'add_internal_note'],
    });

    expect(plan.actions.map((action) => action.type)).not.toContain('close_chat');
  });

  it('asks for CPF/CNPJ before billing lookup when SGP is enabled', () => {
    const plan = planFor({
      message: 'Preciso da segunda via do boleto',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['customer_identifier']);
    expect(plan.response).toContain('CPF/CNPJ');
  });

  it('plans CRM save and SGP lookup when billing identifier is present', () => {
    const plan = planFor({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    });

    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.actions.map((action) => action.type)).toEqual([
      'crm_update_contact_custom_fields',
      'sgp_fetch_contact_panel_data',
    ]);
    expect((plan.actions[0] as any).payload.fields['cpf-field-id']).toBe('52998224725');
  });

  it('asks for the missing scheduling slot', () => {
    const plan = planFor({
      message: 'Quero agendar uma consulta amanha',
      enabledToolNames: ['mcp_call_tool'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['time']);
    expect(plan.response).toContain('horario');
  });

  it('asks for order/protocol before status workflow continues', () => {
    const plan = planFor({
      message: 'Qual o status do meu pedido?',
      enabledToolNames: ['mcp_call_tool'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['order_or_request_id']);
    expect(plan.response).toContain('pedido');
  });

  it('plans operational support lookup when identifier is present', () => {
    const plan = planFor({
      message: 'Estou sem acesso e meu CPF e 529.982.247-25',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    });

    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.actions.map((action) => action.type)).toEqual([
      'crm_update_contact_custom_fields',
      'sgp_fetch_contact_panel_data',
    ]);
  });

  it('uses CPF/CNPJ from CRM to consult contract information without asking again', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Quero informacoes sobre meu contrato',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Quero informacoes sobre meu contrato',
      contact: {
        ...contact,
        custom_fields: { CPF: '529.982.247-25' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    });

    expect(intentResolution.intent).toBe('document_request');
    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.missingSlots).toEqual([]);
    expect(plan.slotExtraction.slots.customer_identifier).toBe('52998224725');
    expect(plan.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
  });

  it('asks for CPF/CNPJ before contract information lookup when CRM has no identifier', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Quero informacoes sobre meu contrato',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Quero informacoes sobre meu contrato',
      contact: {
        ...contact,
        custom_fields: {},
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.response).toContain('CPF/CNPJ');
    expect(plan.actions).toEqual([]);
  });

  it('does not ask for CPF/CNPJ again when a recent SGP lookup already exists', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Quais sao meus contratos?',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Quais sao meus contratos?',
      contact: {
        ...contact,
        custom_fields: {},
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
      recentToolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: {
            contracts: [{ id: '24123', planDescription: 'PLANO 1000 MEGA' }],
          },
        },
      ],
    });

    expect(intentResolution.intent).toBe('document_request');
    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.response).toBeNull();
    expect(plan.missingSlots).toEqual([]);
    expect(plan.metadata.recentToolMemory).toBe(true);
  });

  it('lets the LLM continue the sale when the customer confirms the promotional internet plan', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Esse plano promocional, acho que quero ele',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Esse plano promocional, acho que quero ele',
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'high',
    });

    expect(intentResolution.intent).toBe('purchase_inquiry');
    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.response).toBeNull();
    expect(plan.handledByWorkflow).toBe(false);
  });

  it('lets the LLM continue the sale when the customer selects a specific internet plan after the catalog', () => {
    const history = [
      'Atendente: NOSSOS PLANOS DE INTERNET:',
      '500 MEGA (somente internet)',
      '1000 MEGA (+ 100 canais de TV)',
      'Algum desses planos te interessou?',
    ].join('\n');
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Esse de 1000 MEGA',
      chatHistory: history,
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Esse de 1000 MEGA',
      chatHistory: history,
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'high',
    });

    expect(intentResolution.intent).toBe('purchase_inquiry');
    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.response).toBeNull();
    expect(plan.handledByWorkflow).toBe(false);
  });

  it('lets the LLM continue the sale when the customer selects an internet catalog option by price', () => {
    const history = [
      'Atendente: NOSSOS PLANOS DE INTERNET:',
      '500 MEGA (somente internet)',
      'R$99,90/mes valor com desconto de pontualidade',
      '1000 MEGA (+ 100 canais de TV)',
      'R$149,90/mes valor com desconto de pontualidade',
      'Algum desses planos te interessou?',
    ].join('\n');
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Esse de R$99,90',
      chatHistory: history,
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Esse de R$99,90',
      chatHistory: history,
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'high',
    });

    expect(intentResolution.intent).toBe('purchase_inquiry');
    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.response).toBeNull();
    expect(plan.handledByWorkflow).toBe(false);
  });
});
