import { describe, expect, it } from 'vitest';
import { inspectAutopilotPrimaryDeliveryOutcome } from '@/services/workflow-runtime/autopilot-primary';

describe('native autopilot delivery outcome', () => {
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
