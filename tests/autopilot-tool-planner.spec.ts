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

  it('repairs lookup promises with handoff when no executable tool exists', () => {
    const result = runPlanner({
      message: 'Voce consegue verificar o status do meu pedido?',
      response: 'Vou verificar o status do pedido no sistema.',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      actions: [],
    });

    expect(result.responseOverride).toContain('encaminhar');
    expect(result.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
    expect(result.promiseValidation.repairReason).toBe('promise_handoff');
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
