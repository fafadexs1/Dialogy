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
});
