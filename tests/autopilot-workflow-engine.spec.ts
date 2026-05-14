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

const commercialTeam = {
  id: 'team-commercial',
  name: 'Comercial',
  routingConfig: { enabled: true, autoTransfer: true },
} satisfies ToolRouterTeam;

function planFor(input: {
  message: string;
  chatHistory?: string;
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
  const intentResolution = resolveAutopilotIntent({
    customerMessage: input.message,
    chatHistory: input.chatHistory,
  });
  return resolveAutopilotWorkflowPlan({
    intentResolution,
    customerMessage: input.message,
    chatHistory: input.chatHistory,
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

  it('targets the explicitly mentioned team during human handoff', () => {
    const plan = planFor({
      message: 'Quero falar com um atendente do comercial',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      teams: [supportTeam, commercialTeam],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.response).toContain('equipe Comercial');
    expect((plan.actions.find((action) => action.type === 'transfer_chat') as any)?.payload.teamId).toBe('team-commercial');
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

  it('lets the close intent gate veto deterministic close words', () => {
    const plan = planFor({
      message: 'Antes disso quero comparar planos e talvez fechar depois, nao encerra o atendimento.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
      closeIntentGate: {
        execute: false,
        confidence: 'high',
        reason: 'Cliente negou encerramento e usa fechar em contexto comercial.',
      },
    });

    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.actions).toEqual([]);
  });

  it('lets the close intent gate approve explicit close requests', () => {
    const plan = planFor({
      message: 'Pode finalizar por aqui',
      enabledToolNames: ['close_chat', 'add_internal_note'],
      closeIntentGate: {
        execute: true,
        confidence: 'high',
        reason: 'Cliente pediu para finalizar a conversa atual.',
      },
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('does not close the chat when fechar refers to a commercial deal', () => {
    const plan = planFor({
      message: 'Pode me passar para um atendente do comercial para fechar hoje?',
      enabledToolNames: ['close_chat', 'transfer_chat', 'add_internal_note'],
      teams: [supportTeam, commercialTeam],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
    expect((plan.actions.find((action) => action.type === 'transfer_chat') as any)?.payload.teamId).toBe('team-commercial');
  });

  it('does not close the chat when the customer explicitly negates closing', () => {
    const plan = planFor({
      message: 'Antes disso quero comparar planos e talvez fechar depois, nao encerra o atendimento.',
      enabledToolNames: ['close_chat', 'transfer_chat', 'add_internal_note'],
      teams: [supportTeam, commercialTeam],
    });

    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.actions).toEqual([]);
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

  it('continues technical support lookup when the customer replies with CPF only', () => {
    const history = [
      'Cliente: Problemas de conexao',
      'Atendente: Verifique o cabo da fibra e reinicie o modem.',
      'Cliente: Nao resolveu',
      'Atendente: Para verificar o que esta acontecendo, preciso do seu CPF para acessar o sistema.',
    ].join('\n');

    const plan = planFor({
      message: '70280417195',
      chatHistory: history,
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    });

    expect(plan.metadata.intent).toBe('troubleshooting');
    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.response).toBeNull();
    expect(plan.actions.map((action) => action.type)).toEqual([
      'crm_update_contact_custom_fields',
      'sgp_fetch_contact_panel_data',
    ]);
    expect((plan.actions[0] as any).payload.fields['cpf-field-id']).toBe('70280417195');
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

  it('uses CPF/CNPJ from CRM for operational lookup when technical intent is inferred', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Minha internet ta ruim',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Minha internet ta ruim',
      contact: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    });

    expect(intentResolution.intent).toBe('troubleshooting');
    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.missingSlots).toEqual([]);
    expect(plan.slotExtraction.slots.customer_identifier).toBe('01298570174');
    expect(plan.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
  });

  it('uses CPF/CNPJ from CRM for LOS/router troubleshooting lookups', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'A luz LOS do roteador esta vermelha e nao navega nada',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'A luz LOS do roteador esta vermelha e nao navega nada',
      contact: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    });

    expect(intentResolution.intent).toBe('troubleshooting');
    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
  });

  it('uses SGP for contract document copies when CPF/CNPJ is known', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Preciso de uma copia do meu contrato de internet',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Preciso de uma copia do meu contrato de internet',
      contact: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    });

    expect(intentResolution.intent).toBe('document_request');
    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
  });

  it('lets the AI workflow classifier request SGP lookup for technical language not covered deterministically', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'O equipamento fica piscando diferente e nao navega direito',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'O equipamento fica piscando diferente e nao navega direito',
      contact: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
      aiWorkflowDecision: {
        shouldUseTools: true,
        needsCustomerIdentifier: false,
        suggestedTools: ['sgp_fetch_contact_panel_data'],
        confidence: 0.84,
        reason: 'Cliente descreve falha operacional de conectividade.',
      },
    });

    expect(plan.executionMode).toBe('pre_response_tools');
    expect(plan.reason).toContain('Workflow IA');
    expect(plan.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
  });

  it('lets the AI workflow classifier ask for CPF/CNPJ before a safe lookup', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'O equipamento fica piscando diferente e nao navega direito',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'O equipamento fica piscando diferente e nao navega direito',
      contact,
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
      aiWorkflowDecision: {
        shouldUseTools: true,
        needsCustomerIdentifier: true,
        suggestedTools: ['sgp_fetch_contact_panel_data'],
        confidence: 0.84,
        reason: 'Cliente descreve falha operacional de conectividade.',
      },
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['customer_identifier']);
    expect(plan.response).toContain('CPF/CNPJ');
    expect(plan.actions).toEqual([]);
  });

  it('ignores low-confidence AI workflow suggestions', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Quero conhecer os planos disponiveis',
    });
    const plan = resolveAutopilotWorkflowPlan({
      intentResolution,
      customerMessage: 'Quero conhecer os planos disponiveis',
      contact: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      availableTeams: [supportTeam],
      knowledgeCoverage: 'low',
      slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
      aiWorkflowDecision: {
        shouldUseTools: true,
        needsCustomerIdentifier: false,
        suggestedTools: ['sgp_fetch_contact_panel_data'],
        confidence: 0.4,
        reason: 'Baixa confianca.',
      },
    });

    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.actions).toEqual([]);
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
