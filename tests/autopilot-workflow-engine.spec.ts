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
});
