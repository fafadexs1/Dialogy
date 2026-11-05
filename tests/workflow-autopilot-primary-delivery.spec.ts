import { describe, expect, it } from 'vitest';
import {
  authorizeNativeWorkflowConnectedTools,
  filterNativeToolsByKnownFields,
  inspectAutopilotPrimaryDeliveryOutcome,
} from '@/services/workflow-runtime/autopilot-primary';
import {
  extractSgpContractIp,
  hydrateClientIpArgument,
} from '@/services/workflow-runtime/autopilot-tool-bridge';

describe('native autopilot delivery outcome', () => {
  it('exposes a native tool only after all of its required slots are known', () => {
    const definitions = [{
      name: 'sgp_fetch_contact_panel_data' as const,
      description: 'Consulta SGP',
      riskLevel: 'low' as const,
      idempotent: true,
      timeoutMs: 20_000,
      maxAttempts: 1,
      requiresHumanApproval: false,
      requiredSlots: ['customer_identifier'],
      inputSchema: {},
      outputSchema: {},
    }];

    expect(filterNativeToolsByKnownFields(definitions, {})).toEqual([]);
    expect(filterNativeToolsByKnownFields(definitions, { customer_identifier: '86675273191' }))
      .toEqual(definitions);
    expect(filterNativeToolsByKnownFields(definitions, { CPF: '86675273191' }))
      .toEqual(definitions);
  });

  it('hydrates the router IP only from the SGP result of the same agent run', () => {
    const ip = extractSgpContractIp({
      contracts: [{ id: '16318', ip: '100.66.15.159' }],
    });

    expect(hydrateClientIpArgument({}, ip)).toEqual({ client_ip: '100.66.15.159' });
    expect(hydrateClientIpArgument({ client_ip: '10.0.0.1' }, ip))
      .toEqual({ client_ip: '100.66.15.159' });
    expect(hydrateClientIpArgument({}, null)).toEqual({});
    expect(extractSgpContractIp({
      contracts: [
        { id: '11111', ip: '100.64.0.1' },
        { id: '16318', ip: '100.66.15.159' },
      ],
    }, '16318')).toBe('100.66.15.159');
    expect(extractSgpContractIp({
      contracts: [
        { id: '11111', ip: '100.64.0.1' },
        { id: '16318', ip: '100.66.15.159' },
      ],
    })).toBeNull();
    expect(extractSgpContractIp({
      contracts: [{ id: '16318', ip: 'IP indisponivel' }],
    }, '16318')).toBeNull();
  });

  it('authorizes a globally enabled tool connected by the native workflow', () => {
    const policy = authorizeNativeWorkflowConnectedTools({
      activeNodeId: 'agente-principal',
      toolMode: 'on_demand',
      globallyEnabledToolNames: ['add_internal_note', 'sgp_fetch_contact_panel_data'],
      attachedToolNames: ['add_internal_note'],
      allowedToolNames: ['add_internal_note'],
      toolInstructionsByName: {},
      allowedKnowledgeDocumentIds: undefined,
      reason: 'flow_scoped_tools_allowed',
    }, ['sgp_fetch_contact_panel_data', 'tool_not_enabled_globally']);

    expect(policy.allowedToolNames).toEqual([
      'add_internal_note',
      'sgp_fetch_contact_panel_data',
    ]);
    expect(policy.allowedToolNames).not.toContain('tool_not_enabled_globally');
    expect(policy.reason).toBe('native_workflow_connected_tools_allowed');
  });

  it('does not bypass an explicit deny policy for connected native tools', () => {
    const policy = authorizeNativeWorkflowConnectedTools({
      activeNodeId: 'agente-principal',
      toolMode: 'deny',
      globallyEnabledToolNames: ['sgp_fetch_contact_panel_data'],
      attachedToolNames: [],
      allowedToolNames: [],
      toolInstructionsByName: {},
      allowedKnowledgeDocumentIds: undefined,
      reason: 'policy_denied_tools',
    }, ['sgp_fetch_contact_panel_data']);

    expect(policy.allowedToolNames).toEqual([]);
    expect(policy.reason).toBe('policy_denied_tools');
  });

  it('recovers a generated response when an agent terminal route bypasses output.respond', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'ai.agent',
        status: 'completed',
        selectedOutput: 'limit_reached',
        output: {
          type: 'final',
          response: 'Resposta gerada que precisa ser entregue.',
          completionStatus: 'partial',
        },
      }],
    });

    expect(outcome).toEqual({
      responseSent: false,
      handoffCompleted: false,
      conversationClosed: false,
      recoveryResponse: 'Resposta gerada que precisa ser entregue.',
    });
  });

  it('turns confirmation_required into an actionable customer response', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [],
      failure: {
        message: 'Nao foi possivel concluir esta etapa com seguranca.',
        details: {
          code: 'TOOL_REJECTED',
          message: '[tool_policy:confirmation_required] Preciso da confirmacao explicita antes de executar reboot_router.',
        },
      },
    });

    expect(outcome.recoveryResponse).toContain('ainda nao foi executada');
    expect(outcome.recoveryResponse).toContain('"confirmo"');
    expect(outcome.recoveryResponse).not.toContain('instabilidade');
  });

  it('reports a workflow failure without restarting the conversation with a greeting', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({ failure: { message: 'Workflow inválido: memória sem configuração.' } });
    expect(outcome.recoveryResponse).toContain('solicitação continua pendente');
    expect(outcome.recoveryResponse).not.toMatch(/ol[aá]|como posso ajudar/i);
  });

  it('reports invalid tool arguments instead of hiding them behind instability', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [],
      failure: {
        message: 'Nao foi possivel concluir esta etapa com seguranca.',
        details: {
          code: 'INVALID_TOOL_ARGUMENTS',
          message: 'change_wifi_channel input failed JSON schema validation.',
        },
      },
    });

    expect(outcome.recoveryResponse).toContain('formato invalido');
    expect(outcome.recoveryResponse).toContain('Nenhuma alteracao foi aplicada');
    expect(outcome.recoveryResponse).not.toContain('instabilidade');
  });

  it('recognizes a provider-accepted response as delivered', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'output.respond',
        status: 'success',
        output: {
          message: 'Enviada.',
          delivery: { success: true },
        },
      }],
    });

    expect(outcome.responseSent).toBe(true);
    expect(outcome.recoveryResponse).toBe('Enviada.');
  });

  it('does not force a customer response after a successful handoff', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'output.handoff',
        status: 'completed',
        output: { transferred: true },
      }],
    });

    expect(outcome.handoffCompleted).toBe(true);
    expect(outcome.responseSent).toBe(false);
  });

  it('counts an explicit customer handoff message as a sent response', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'output.handoff',
        status: 'completed',
        output: {
          transferred: true,
          customerMessage: 'Obrigado. Seu atendimento foi encaminhado.',
          customerMessageSent: true,
        },
      }],
    });

    expect(outcome.handoffCompleted).toBe(true);
    expect(outcome.responseSent).toBe(true);
    expect(outcome.recoveryResponse).toBe('Obrigado. Seu atendimento foi encaminhado.');
  });

  it('keeps only the public handoff message available for delivery recovery', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'ai.agent',
        status: 'route',
        output: {
          type: 'handoff',
          reason: 'Limite operacional',
          summary: 'Resumo interno que não pode ser enviado ao cliente.',
          customerMessage: 'Obrigado. Vou encaminhar seu atendimento.',
        },
      }],
    });

    expect(outcome.responseSent).toBe(false);
    expect(outcome.recoveryResponse).toBe('Obrigado. Vou encaminhar seu atendimento.');
  });

  it('does not force a recovery response after the native close block succeeds', () => {
    const outcome = inspectAutopilotPrimaryDeliveryOutcome({
      executionPath: [{
        nodeType: 'output.close_conversation',
        status: 'completed',
        output: { closed: true },
      }],
    });

    expect(outcome.conversationClosed).toBe(true);
    expect(outcome.responseSent).toBe(false);
  });
});
