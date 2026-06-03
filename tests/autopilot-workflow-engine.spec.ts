import { describe, expect, it } from 'vitest';

import type { Contact } from '@/lib/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { resolveAutopilotWorkflowPlan } from '@/services/autopilot/workflow-engine';

const contact = { id: 'contact-1', workspace_id: 'workspace-1', name: 'Cliente Teste' } satisfies Contact;
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
  enabledToolNames?: string[];
  teams?: ToolRouterTeam[];
  closeIntentGate?: { execute: boolean; confidence: 'low' | 'medium' | 'high'; reason?: string | null } | null;
}) {
  return resolveAutopilotWorkflowPlan({
    intentResolution: resolveAutopilotIntent({ customerMessage: input.message }),
    customerMessage: input.message,
    contact,
    enabledToolNames: input.enabledToolNames || [],
    availableTeams: input.teams || [supportTeam],
    knowledgeCoverage: 'low',
    closeIntentGate: input.closeIntentGate,
  });
}

describe('universal autopilot workflow engine', () => {
  it('handles explicit human handoff without LLM when flow tools allow it', () => {
    const plan = planFor({
      message: 'Quero falar com um atendente humano',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
    });

    expect(plan.executionMode).toBe('direct_response');
    expect(plan.response).toContain('equipe Suporte');
    expect(plan.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('targets an explicitly mentioned team', () => {
    const plan = planFor({
      message: 'Quero falar com um atendente do comercial',
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      teams: [supportTeam, commercialTeam],
    });

    expect((plan.actions.find((action) => action.type === 'transfer_chat') as any)?.payload.teamId).toBe('team-commercial');
  });

  it('does not transfer when the flow did not allow transfer_chat', () => {
    const plan = planFor({ message: 'Quero falar com um atendente humano' });
    expect(plan.actions).toEqual([]);
  });

  it('closes the chat only when close_chat is allowed', () => {
    expect(planFor({
      message: 'Pode encerrar o atendimento',
      enabledToolNames: ['close_chat'],
    }).actions.map((action) => action.type)).toEqual(['close_chat']);
    expect(planFor({ message: 'Pode encerrar o atendimento' }).actions).toEqual([]);
  });

  it('honors a close gate approval', () => {
    const plan = planFor({
      message: 'ja deu por aqui',
      enabledToolNames: ['close_chat'],
      closeIntentGate: { execute: true, confidence: 'medium' },
    });
    expect(plan.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('asks for missing scheduling data generically', () => {
    const plan = planFor({ message: 'Quero agendar uma consulta amanha' });
    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['time']);
    expect(plan.response).toContain('horario');
  });

  it('asks for an order identifier before checking status', () => {
    const plan = planFor({ message: 'Qual o status do meu pedido?' });
    expect(plan.executionMode).toBe('direct_response');
    expect(plan.missingSlots).toEqual(['order_or_request_id']);
  });

  it('does not auto-plan niche tools in the universal core', () => {
    const plan = planFor({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    });
    expect(plan.executionMode).toBe('continue_llm');
    expect(plan.actions).toEqual([]);
  });
});
