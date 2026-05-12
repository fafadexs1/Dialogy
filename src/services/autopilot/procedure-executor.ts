/**
 * Procedure Executor
 *
 * The step-by-step execution engine. Given an active ProcedureExecutionContext
 * and a customer message, it advances through the procedure graph until it
 * either needs customer input, completes, or exhausts the step budget.
 *
 * Key design decisions:
 *  - Max 6 steps per invocation (safety limit)
 *  - gather_data pauses execution until next customer message
 *  - tool_call / validate / respond / decide can chain without waiting
 *  - Failures trigger retry → handoff cascade
 */

import type { AgentToolAction } from '@/services/agent-tools/types';
import type {
  ProcedureGraph,
  ProcedureStep,
  ProcedureExecutionContext,
  ProcedureAdvanceResult,
  StepExecutionRecord,
} from './procedure-types';
import {
  saveProcedureExecution,
  completeProcedureExecution,
} from './procedure-store';

const MAX_STEPS_PER_INVOCATION = 6;

// ---------------------------------------------------------------------------
// Template interpolation — replaces {{var}} with values from context
// ---------------------------------------------------------------------------

function interpolate(
  template: string,
  context: ProcedureExecutionContext,
  extras?: Record<string, unknown>,
): string {
  const vars: Record<string, string> = {
    ...context.collectedSlots,
    ...Object.fromEntries(
      Object.entries(context.decisions).map(([k, v]) => [k, String(v)]),
    ),
    ...Object.fromEntries(
      Object.entries(extras || {}).map(([k, v]) => [k, String(v)]),
    ),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

// ---------------------------------------------------------------------------
// Step resolvers
// ---------------------------------------------------------------------------

function findStep(graph: ProcedureGraph, stepId: string): ProcedureStep | null {
  return graph.steps.find((s) => s.id === stepId) || null;
}

function findNextStep(
  graph: ProcedureGraph,
  currentStep: ProcedureStep,
  context: ProcedureExecutionContext,
): ProcedureStep | null {
  // If step has branches, check them first
  if (currentStep.branches && currentStep.branches.length > 0) {
    for (const branch of currentStep.branches) {
      const conditionValue = context.decisions[currentStep.id];
      if (conditionValue && conditionValue.includes(branch.condition)) {
        const target = findStep(graph, branch.nextStepId);
        if (target) return target;
      }
    }
  }

  // Default: follow nextStepId
  if (currentStep.nextStepId) {
    return findStep(graph, currentStep.nextStepId);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Individual step executors
// ---------------------------------------------------------------------------

type StepResult = {
  status: 'continue' | 'pause' | 'complete' | 'error';
  response?: string | null;
  action?: AgentToolAction | null;
  error?: string;
  slotCollected?: Record<string, string>;
  decision?: string;
};

function executeGatherDataStep(
  step: ProcedureStep,
  customerMessage: string,
  context: ProcedureExecutionContext,
  isResuming: boolean,
): StepResult {
  if (!isResuming) {
    // First time hitting this step — ask the question
    const prompt = step.promptTemplate
      ? interpolate(step.promptTemplate, context)
      : `Para seguir, me informe: ${(step.requiredSlots || []).join(', ')}.`;

    return { status: 'pause', response: prompt };
  }

  // Resuming — the customer message IS the answer
  const collected: Record<string, string> = {};
  if (step.requiredSlots && step.requiredSlots.length > 0) {
    // Map the customer message to the first required slot
    for (const slot of step.requiredSlots) {
      if (!context.collectedSlots[slot]) {
        collected[slot] = customerMessage.trim();
        break; // one slot per message
      }
    }
  } else {
    collected['_response'] = customerMessage.trim();
  }

  return { status: 'continue', slotCollected: collected };
}

function executeToolCallStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  if (!step.toolName) {
    return { status: 'error', error: 'Passo de tool_call sem toolName definido.' };
  }

  // Build payload from template
  const payload: Record<string, unknown> = {};
  if (step.toolPayloadTemplate) {
    for (const [key, template] of Object.entries(step.toolPayloadTemplate)) {
      payload[key] = interpolate(template, context);
    }
  }

  const action: AgentToolAction = {
    type: step.toolName as any,
    reason: `Procedure step: ${step.label}`,
    payload,
  };

  // For MCP tools, wrap in mcp_call_tool
  if (step.toolName.startsWith('mcp:')) {
    return {
      status: 'continue',
      action: {
        type: 'mcp_call_tool',
        reason: `Procedure step: ${step.label}`,
        payload: {
          toolName: step.toolName,
          arguments: payload,
        },
      },
    };
  }

  return { status: 'continue', action };
}

function executeValidateStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  // For now, validate steps are simple pass-through
  // In future, they can check conditions against collected slots
  const condition = step.condition || '';
  const interpolated = interpolate(condition, context);

  // Simple heuristic: if the condition mentions a slot that exists, pass
  const slotKeys = Object.keys(context.collectedSlots);
  const passes = slotKeys.length > 0 || !condition;

  if (passes) {
    return { status: 'continue' };
  }

  // Failed validation
  const onFail = step.onFail || 'skip';
  if (onFail === 'abort' || onFail === 'handoff') {
    return {
      status: 'error',
      error: `Validação falhou: ${interpolated}`,
    };
  }

  // skip — just continue
  return { status: 'continue' };
}

function executeDecideStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  extras?: Record<string, unknown>,
): StepResult {
  // For decide steps, we store the decision prompt for the LLM
  // The orchestrator will call the LLM with this prompt and store the result
  // For the initial version, we auto-decide based on available data

  if (step.branches && step.branches.length === 1) {
    // Only one branch — auto-select
    return {
      status: 'continue',
      decision: step.branches[0].condition,
    };
  }

  // Multiple branches — need LLM decision (future)
  // For now, select first branch
  const firstBranch = step.branches?.[0];
  if (firstBranch) {
    return {
      status: 'continue',
      decision: firstBranch.condition,
    };
  }

  return { status: 'continue', decision: 'default' };
}

function executeRespondStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  if (step.responseTemplate) {
    const response = interpolate(step.responseTemplate, context);
    return { status: 'continue', response };
  }

  // useLlm = true means the orchestrator should generate via LLM
  // We signal this by returning null response — the orchestrator handles it
  return { status: 'continue', response: null };
}

function executeHandoffStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  const reason = step.handoffReason || 'Procedimento requer atendimento humano.';
  return {
    status: 'complete',
    response: interpolate(reason, context),
    action: {
      type: 'transfer_chat',
      reason: `Procedure handoff: ${step.label}`,
      payload: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function advanceProcedure(input: {
  graph: ProcedureGraph;
  context: ProcedureExecutionContext;
  customerMessage: string;
  availableTeams?: Array<{ id: string; name: string }>;
}): Promise<ProcedureAdvanceResult> {
  const { graph, context, customerMessage } = input;
  const executedSteps: string[] = [];
  const actions: ProcedureAdvanceResult['actions'] = [];
  let responseText: string | null = null;
  let stepsExecuted = 0;
  let isResuming = context.status === 'waiting_input';

  // Set status to running
  context.status = 'running';

  while (stepsExecuted < MAX_STEPS_PER_INVOCATION) {
    const currentStep = findStep(graph, context.currentStepId);
    if (!currentStep) {
      // No more steps — procedure complete
      context.status = 'completed';
      context.completedAt = new Date().toISOString();
      break;
    }

    stepsExecuted++;
    executedSteps.push(currentStep.id);

    const stepRecord: StepExecutionRecord = {
      stepId: currentStep.id,
      stepLabel: currentStep.label,
      startedAt: new Date().toISOString(),
      status: 'success',
    };

    console.log(
      `[PROCEDURE_RUNTIME] chat=${context.chatId} procedure=${context.procedureName} ` +
      `step=${currentStep.id} type=${currentStep.type} label="${currentStep.label.slice(0, 60)}"`,
    );

    let result: StepResult;

    try {
      switch (currentStep.type) {
        case 'gather_data':
          result = executeGatherDataStep(currentStep, customerMessage, context, isResuming);
          break;
        case 'tool_call':
          result = executeToolCallStep(currentStep, context);
          break;
        case 'validate':
          result = executeValidateStep(currentStep, context);
          break;
        case 'decide':
          result = executeDecideStep(currentStep, context);
          break;
        case 'respond':
          result = executeRespondStep(currentStep, context);
          break;
        case 'handoff':
          result = executeHandoffStep(currentStep, context);
          break;
        default:
          result = { status: 'error', error: `Tipo de passo desconhecido: ${currentStep.type}` };
      }
    } catch (error) {
      result = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // After first step, we're no longer resuming
    isResuming = false;

    // Process step result
    if (result.slotCollected) {
      Object.assign(context.collectedSlots, result.slotCollected);
    }
    if (result.decision) {
      context.decisions[currentStep.id] = result.decision;
    }
    if (result.response) {
      responseText = result.response;
    }
    if (result.action) {
      actions.push({
        type: result.action.type,
        reason: result.action.reason || currentStep.label,
        payload: result.action.payload || {},
      });
    }

    // Handle step outcome
    switch (result.status) {
      case 'pause': {
        // Waiting for customer input
        stepRecord.status = 'waiting';
        context.status = 'waiting_input';
        context.stepHistory.push(stepRecord);
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'waiting_input',
          executedSteps,
        };
      }

      case 'error': {
        stepRecord.status = 'error';
        stepRecord.error = result.error;
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        // Check retry
        const retries = context.retryCount[currentStep.id] || 0;
        const maxRetries = currentStep.maxRetries ?? 2;

        if (retries < maxRetries) {
          context.retryCount[currentStep.id] = retries + 1;
          console.warn(
            `[PROCEDURE_RUNTIME] chat=${context.chatId} step=${currentStep.id} ` +
            `retry ${retries + 1}/${maxRetries}: ${result.error}`,
          );
          // Don't advance — retry same step on next invocation
          context.status = 'running';
          await saveProcedureExecution(context);

          return {
            handled: true,
            response: responseText || 'Houve um problema ao processar. Vou tentar novamente.',
            actions,
            status: 'running',
            executedSteps,
          };
        }

        // Max retries exhausted — fail the procedure
        console.error(
          `[PROCEDURE_RUNTIME] chat=${context.chatId} step=${currentStep.id} ` +
          `max retries exhausted. Error: ${result.error}`,
        );
        context.status = 'failed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText || 'Não consegui completar o procedimento automaticamente. Vou encaminhar para a equipe.',
          actions: [
            ...actions,
            {
              type: 'add_internal_note',
              reason: `Procedimento "${context.procedureName}" falhou no passo "${currentStep.label}"`,
              payload: { content: `PRE falhou: ${result.error}` },
            },
          ],
          status: 'failed',
          executedSteps,
          completionReason: result.error,
        };
      }

      case 'complete': {
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);
        context.status = 'completed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'completed',
          executedSteps,
          completionReason: 'Procedimento concluído.',
        };
      }

      case 'continue': {
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        // Move to next step
        const nextStep = findNextStep(graph, currentStep, context);
        if (nextStep) {
          context.currentStepId = nextStep.id;
        } else {
          // No next step — procedure complete
          context.status = 'completed';
          context.completedAt = new Date().toISOString();
          await saveProcedureExecution(context);

          return {
            handled: true,
            response: responseText,
            actions,
            status: 'completed',
            executedSteps,
            completionReason: 'Todos os passos concluídos.',
          };
        }
        break;
      }
    }
  }

  // Exhausted step budget — save and return partial
  await saveProcedureExecution(context);

  return {
    handled: true,
    response: responseText,
    actions,
    status: context.status,
    executedSteps,
  };
}
