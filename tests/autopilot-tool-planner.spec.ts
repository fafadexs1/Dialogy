import { describe, expect, it } from 'vitest';

import { listAgentToolCatalogItems, type AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import { hasExternalLookupPromise, planAutopilotTools } from '@/services/autopilot/tool-planner';
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

function runPlanner(input: {
  message: string;
  chatHistory?: string;
  response?: string | null;
  actions: AgentToolAction[];
  enabledToolNames?: string[];
  toolCatalog?: AgentToolCatalogItem[];
  contactOverride?: Contact;
  intentOverride?: ReturnType<typeof resolveAutopilotIntent>;
}) {
  const intentResolution = input.intentOverride || resolveAutopilotIntent({ customerMessage: input.message });
  const resolvedContact = input.contactOverride || contact;
  return planAutopilotTools({
    response: input.response ?? null,
    customerMessage: input.message,
    chatHistory: input.chatHistory,
    intentResolution,
    slotExtraction: extractAutopilotSlots({
      customerMessage: input.message,
      contact: resolvedContact,
    }),
    actions: input.actions,
    enabledToolNames: input.enabledToolNames || ['transfer_chat', 'add_internal_note'],
    toolCatalog: input.toolCatalog || listAgentToolCatalogItems(),
    availableTeams: [team],
    contact: resolvedContact,
  });
}

describe('autopilot tool planner', () => {
  it('detects external lookup promises', () => {
    expect(hasExternalLookupPromise('Vou verificar seu cadastro no sistema.')).toBe(true);
    expect(hasExternalLookupPromise('Para verificar, vou precisar do seu CPF para acessar o sistema e verificar o que esta acontecendo.')).toBe(true);
    expect(hasExternalLookupPromise('Para consultar, me envie seu CPF.')).toBe(false);
    expect(hasExternalLookupPromise('Nao consigo validar com seguranca qual roteador deve ser reiniciado porque a consulta de contrato nao esta habilitada. Vou precisar de verificacao manual.')).toBe(false);
  });

  it('blocks promised SGP lookup when customer identifier is missing and repairs the response', () => {
    const result = runPlanner({
      message: 'Preciso da segunda via do boleto',
      response: 'Vou consultar sua fatura no sistema.',
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      actions: [
        {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consultar faturas',
          payload: {},
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({ code: 'missing_slots' });
    expect(result.responseOverride).toContain('CPF/CNPJ');
    expect(result.promiseValidation.repairReason).toBe('promise_missing_slots');
  });

  it('blocks tools outside the allowed intent', () => {
    const contactWithCpf: Contact = {
      ...contact,
      custom_fields: { cpf: '529.982.247-25' },
    };
    const result = runPlanner({
      message: 'Quero conhecer os planos',
      contactOverride: contactWithCpf,
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      actions: [
        {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consulta indevida',
          payload: {},
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({ code: 'intent_not_allowed' });
  });

  it('does not create handoff actions for informational catalog lookup promises', () => {
    const result = runPlanner({
      message: 'Quais planos de internet voces tem?',
      response: 'Vou consultar os planos no sistema.',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      actions: [],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.responseOverride).toBeNull();
    expect(result.promiseValidation.promisedExternalLookup).toBe(true);
    expect(result.promiseValidation.repairReason).toBeNull();
  });

  it('allows billing lookup when slots and enabled tools are valid', () => {
    const result = runPlanner({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      response: 'Vou consultar sua fatura no sistema.',
      enabledToolNames: ['crm_update_contact_custom_fields', 'sgp_fetch_contact_panel_data'],
      actions: [
        {
          type: 'crm_update_contact_custom_fields',
          reason: 'Salvar CPF',
          payload: { fields: { CPF: '52998224725' } },
        },
        {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consultar faturas',
          payload: {},
        },
      ],
    });

    expect(result.rejectedActions).toHaveLength(0);
    expect(result.actions.map((action) => action.type)).toEqual([
      'crm_update_contact_custom_fields',
      'sgp_fetch_contact_panel_data',
    ]);
    expect(result.promiseValidation.hasExecutableLookupTool).toBe(true);
  });

  it('allows read-only SGP lookup for unknown intent when CPF/CNPJ is already known', () => {
    const result = runPlanner({
      message: '01298570174',
      response: 'Vou consultar seu cadastro no sistema.',
      contactOverride: {
        ...contact,
        custom_fields: { CPF: '01298570174' },
      },
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      actions: [
        {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consultar dados operacionais com identificador conhecido.',
          payload: {},
        },
      ],
    });

    expect(result.rejectedActions).toHaveLength(0);
    expect(result.actions.map((action) => action.type)).toEqual(['sgp_fetch_contact_panel_data']);
    expect(result.promiseValidation.hasExecutableLookupTool).toBe(true);
  });

  it('allows CRM CPF/CNPJ capture for unknown intent before operational lookup', () => {
    const result = runPlanner({
      message: '01298570174',
      response: null,
      enabledToolNames: ['crm_update_contact_custom_fields', 'sgp_fetch_contact_panel_data'],
      intentOverride: { intent: 'unknown', confidence: 0.42, reason: 'Contexto ambiguo.' } as any,
      actions: [
        {
          type: 'crm_update_contact_custom_fields',
          reason: 'Salvar CPF/CNPJ informado pelo cliente.',
          payload: { fields: { CPF: '01298570174' } },
        },
        {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consultar dados operacionais com identificador informado.',
          payload: {},
        },
      ],
    });

    expect(result.rejectedActions).toHaveLength(0);
    expect(result.actions.map((action) => action.type)).toEqual([
      'crm_update_contact_custom_fields',
      'sgp_fetch_contact_panel_data',
    ]);
  });

  it('allows close_chat with configurable close options', () => {
    const result = runPlanner({
      message: 'pode encerrar o atendimento',
      enabledToolNames: ['close_chat'],
      actions: [
        {
          type: 'close_chat',
          reason: 'Cliente pediu encerramento.',
          payload: {
            reasonTagId: 'tag-1',
            notes: 'Cliente pediu encerramento pelo WhatsApp.',
            sendCloseMessage: false,
          },
        },
      ],
    });

    expect(result.rejectedActions).toHaveLength(0);
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('rejects invalid close_chat payloads', () => {
    const result = runPlanner({
      message: 'pode encerrar o atendimento',
      enabledToolNames: ['close_chat'],
      actions: [
        {
          type: 'close_chat',
          reason: 'Payload invalido',
          payload: {
            sendCloseMessage: 'sim',
          } as any,
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({ code: 'invalid_payload' });
  });

  it('does not turn a lookup promise into a handoff without an explicit human request', () => {
    const result = runPlanner({
      message: 'Voce consegue verificar o status do meu pedido?',
      response: 'Vou verificar o status do pedido no sistema.',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      actions: [],
    });

    expect(result.responseOverride).toContain('Nao tenho uma ferramenta');
    expect(result.actions).toEqual([]);
    expect(result.promiseValidation.repairReason).toBe('promise_without_tool');
  });

  it('rejects transfer actions proposed without an explicit human request', () => {
    const result = runPlanner({
      message: 'Minha internet esta falhando',
      response: 'Vou encaminhar para a equipe.',
      actions: [
        {
          type: 'add_internal_note',
          reason: 'Modelo sugeriu encaminhamento',
          payload: { content: 'Encaminhar para suporte.' },
        },
        {
          type: 'transfer_chat',
          reason: 'Modelo sugeriu encaminhamento',
          payload: { teamId: team.id },
        },
      ],
    });

    expect(result.actions).toEqual([]);
    expect(result.rejectedActions).toHaveLength(2);
    expect(result.rejectedActions.every((item) => item.code === 'intent_not_allowed')).toBe(true);
  });

  it('uses clinical red flags from history and hydrates the transfer target selected by the model', () => {
    const result = runPlanner({
      message: 'Ja te falei hoje as 19h00',
      chatHistory: [
        'Cliente: Minha filha Joaquina e um bebe de 6 meses.',
        'Cliente: Ela esta com febre de 38,5, cansaco e coriza.',
        'Cliente: Esta com a boca seca e sem urinar.',
        'Atendente: Qual horario fica melhor para a consulta urgente?',
      ].join('\n'),
      response: 'Vou encaminhar seu atendimento agora mesmo para nossa equipe humana.',
      intentOverride: {
        intent: 'scheduling_request',
        confidence: 0.95,
        reason: 'Cliente confirmou o horario.',
      } as any,
      actions: [
        {
          type: 'transfer_chat',
          reason: 'Sinais de alerta exigem atendimento humano.',
          payload: {
            content: 'Joaquina, 6 meses, febre, boca seca e ausencia de urina.',
          },
        } as any,
        {
          type: 'add_internal_note',
          reason: 'Preservar contexto clinico.',
          payload: {
            content: 'Joaquina, 6 meses, febre, boca seca e ausencia de urina. Horario confirmado: 19h00.',
          },
        },
      ],
    });

    expect(result.rejectedActions).toEqual([]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        type: 'add_internal_note',
      }),
      expect.objectContaining({
        type: 'transfer_chat',
        payload: { teamId: team.id },
      }),
    ]);
    expect(result.metadata).toMatchObject({
      safetyCriticalHandoff: true,
      handoffTeam: { id: team.id, name: team.name },
    });
  });

  it('creates a clinical handoff note when the model only requested transfer', () => {
    const result = runPlanner({
      message: 'Hoje as 19h00',
      chatHistory: 'Cliente: Minha bebe de 6 meses esta com febre, boca seca e sem urinar.',
      response: 'Vou transferir para a equipe humana.',
      actions: [{
        type: 'transfer_chat',
        reason: 'Urgencia clinica.',
        payload: { teamId: team.id },
      }],
    });

    expect(result.actions.map((action) => action.type)).toEqual([
      'add_internal_note',
      'transfer_chat',
    ]);
    expect((result.actions[0] as any).payload.content).toContain('sem urinar');
  });

  it('blocks model-generated close_chat when the customer only confirmed a completed task', () => {
    const result = runPlanner({
      message: 'Pode sim',
      response: 'Seu pre-cadastro foi concluido.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
      actions: [{
        type: 'close_chat',
        reason: 'Pre-cadastro concluido.',
        payload: { sendCloseMessage: true },
      }],
    });

    expect(result.actions).toEqual([]);
    expect(result.rejectedActions).toEqual([
      expect.objectContaining({
        code: 'intent_not_allowed',
        action: expect.objectContaining({ type: 'close_chat' }),
      }),
    ]);
  });

  it('rejects MCP reboot when the customer asks for Wi-Fi credentials lookup', () => {
    const rebootTool: AgentToolCatalogItem = {
      name: 'mcp:router:reboot_router' as any,
      version: 'mcp',
      description: 'Reinicia o roteador do assinante.',
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: false,
      timeoutMs: 8000,
      maxAttempts: 1,
      requiresHumanApproval: false,
      customerVisible: true,
      allowedIntents: ['troubleshooting'],
      requiredSlots: [],
      fallbackAction: 'handoff',
      source: 'mcp',
      enabledByDefault: false,
      serverId: 'router',
      serverName: 'Router',
      inputSchema: null,
      outputSchema: null,
    };

    const result = runPlanner({
      message: 'Esqueci o usuario e senha do Wi-Fi, pode verificar?',
      enabledToolNames: ['mcp:router:reboot_router'],
      toolCatalog: [...listAgentToolCatalogItems(), rebootTool],
      actions: [
        {
          type: 'mcp_call_tool',
          reason: 'Reiniciar roteador',
          payload: {
            toolName: 'mcp:router:reboot_router',
            arguments: {},
          },
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({
      code: 'intent_not_allowed',
    });
    expect(result.rejectedActions[0].reason).toContain('consulta de usuario/senha/SSID');
  });

  it('rejects MCP tools that require human approval', () => {
    const destructiveMcpTool: AgentToolCatalogItem = {
      name: 'mcp:server:delete_account' as any,
      version: 'mcp',
      description: 'Remove conta externa',
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: false,
      timeoutMs: 8000,
      maxAttempts: 1,
      requiresHumanApproval: true,
      customerVisible: true,
      allowedIntents: ['support_request'],
      requiredSlots: [],
      fallbackAction: 'handoff',
      source: 'mcp',
      enabledByDefault: false,
      serverId: 'server',
      serverName: 'Server',
      inputSchema: null,
      outputSchema: null,
    };

    const result = runPlanner({
      message: 'Preciso de suporte',
      enabledToolNames: ['mcp:server:delete_account'],
      toolCatalog: [...listAgentToolCatalogItems(), destructiveMcpTool],
      actions: [
        {
          type: 'mcp_call_tool',
          reason: 'Acao destrutiva',
          payload: {
            toolName: 'mcp:server:delete_account',
            arguments: {},
          },
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({ code: 'requires_human_approval' });
  });

  it('rejects tools whose selection score falls below the execution threshold', () => {
    const weakEvidenceTool: AgentToolCatalogItem = {
      ...listAgentToolCatalogItems()[0],
      name: 'mcp:router:weak_lookup' as any,
      source: 'mcp',
      description: '',
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      requiredSlots: [],
      allowedIntents: ['troubleshooting'],
      requiresHumanApproval: false,
      enabledByDefault: false,
      serverId: 'router',
      serverName: 'Router',
      inputSchema: null,
      outputSchema: null,
    };
    const intentResolution = resolveAutopilotIntent({ customerMessage: 'Minha internet esta lenta' });
    const result = planAutopilotTools({
      response: null,
      customerMessage: 'Minha internet esta lenta',
      intentResolution,
      slotExtraction: { slots: {}, details: [], invalidSlots: [] },
      actions: [{
        type: 'mcp_call_tool',
        reason: 'Consulta fraca sem evidencia operacional.',
        payload: { toolName: 'mcp:router:weak_lookup', arguments: {} },
      }],
      enabledToolNames: ['mcp:router:weak_lookup'],
      toolCatalog: [...listAgentToolCatalogItems(), weakEvidenceTool],
      availableTeams: [team],
      contact,
      scoringWeights: {
        goalMatch: 0,
        procedureStepMatch: 0,
        requiredSlotsPresent: 0,
        policyAllowed: 0,
        toolEvidence: 1,
      },
    });

    expect(result.actions).toHaveLength(0);
    expect(result.rejectedActions[0]).toMatchObject({ code: 'score_below_threshold' });
    expect(result.metadata).toMatchObject({
      capabilityDecisions: [
        expect.objectContaining({
          code: 'score_below_threshold',
          allowed: false,
        }),
      ],
    });
  });
});
