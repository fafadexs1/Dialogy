/**
 * Procedure Executor
 *
 * Executes a compiled procedure graph step by step. The executor owns the
 * deterministic parts of a procedure: data collection, tool orchestration,
 * validation, branching, and persisted state transitions. Optional resolver
 * callbacks let the autopilot LLM compose decisions and final responses when a
 * procedure step explicitly asks for AI behavior.
 */

import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type {
  ProcedureAdvanceResult,
  ProcedureBranch,
  ProcedureExecutionContext,
  ProcedureGraph,
  ProcedureStep,
  StepExecutionRecord,
} from './procedure-types';
import { saveProcedureExecution } from './procedure-store';
import { extractAutopilotSlots, isValidCustomerIdentifier, labelSlotForCustomer } from './slots';
import type { AutopilotSlotName } from './intent-types';

const MAX_STEPS_PER_INVOCATION = 6;

export type ProcedureDecisionResolver = (input: {
  step: ProcedureStep;
  context: ProcedureExecutionContext;
  customerMessage: string;
  branches: ProcedureBranch[];
  prompt: string;
  toolResults: AgentToolExecutionResult[];
}) => Promise<string | null | undefined>;

export type ProcedureResponseResolver = (input: {
  step: ProcedureStep;
  context: ProcedureExecutionContext;
  customerMessage: string;
  prompt: string;
  toolResults: AgentToolExecutionResult[];
}) => Promise<string | null | undefined>;

type StepResult = {
  status: 'continue' | 'pause' | 'wait_tool' | 'complete' | 'error';
  response?: string | null;
  action?: AgentToolAction | null;
  error?: string;
  slotCollected?: Record<string, string>;
  decision?: string;
  output?: unknown;
};

function interpolate(
  template: string,
  context: ProcedureExecutionContext,
  extras?: Record<string, unknown>,
): string {
  const vars: Record<string, string> = {
    ...context.collectedSlots,
    ...Object.fromEntries(
      Object.entries(context.decisions).map(([key, value]) => [key, String(value)]),
    ),
    ...Object.fromEntries(
      Object.entries(extras || {}).map(([key, value]) => [key, String(value)]),
    ),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownAutopilotSlot(slot: string): slot is AutopilotSlotName {
  return [
    'name',
    'customer_identifier',
    'date',
    'time',
    'phone',
    'email',
    'address',
    'order_or_request_id',
    'invoice_or_payment_id',
    'product_or_service_id',
    'product_or_service_preference',
    'quantity',
    'location',
  ].includes(slot);
}

function findStep(graph: ProcedureGraph, stepId: string): ProcedureStep | null {
  return graph.steps.find((step) => step.id === stepId) || null;
}

function getToolResultsForStep(
  context: ProcedureExecutionContext,
  stepId: string,
): AgentToolExecutionResult[] {
  const raw = context.toolResults?.[stepId];
  if (!raw) return [];
  return Array.isArray(raw)
    ? raw as AgentToolExecutionResult[]
    : [raw as AgentToolExecutionResult];
}

function getAllToolResults(context: ProcedureExecutionContext): AgentToolExecutionResult[] {
  return Object.values(context.toolResults || {}).flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value)
      ? value as AgentToolExecutionResult[]
      : [value as AgentToolExecutionResult];
  });
}

function hasSuccessfulToolResult(context: ProcedureExecutionContext): boolean {
  return getAllToolResults(context).some((result) => result.status === 'success');
}

function hasFailedToolResult(context: ProcedureExecutionContext): boolean {
  return getAllToolResults(context).some((result) => result.status !== 'success');
}

function summarizeRuntimeContext(
  context: ProcedureExecutionContext,
  customerMessage: string,
): string {
  const slotValues = Object.values(context.collectedSlots || {}).join(' ');
  const decisionValues = Object.values(context.decisions || {}).join(' ');
  const toolValues = getAllToolResults(context)
    .map((result) => [
      result.toolName,
      result.status,
      result.error || '',
      JSON.stringify(result.output || {}),
    ].join(' '))
    .join(' ');

  return normalizeText([
    customerMessage,
    slotValues,
    decisionValues,
    toolValues,
  ].filter(Boolean).join(' '));
}

function matchDecisionToBranch(
  branches: ProcedureBranch[] | undefined,
  decision: string | null | undefined,
): ProcedureBranch | null {
  if (!branches?.length || !decision) return null;
  const normalizedDecision = normalizeText(decision);

  return branches.find((branch) => {
    const condition = normalizeText(branch.condition);
    const nextStepId = normalizeText(branch.nextStepId);
    return normalizedDecision === condition
      || normalizedDecision === nextStepId
      || normalizedDecision.includes(condition)
      || condition.includes(normalizedDecision);
  }) || null;
}

function chooseBranchHeuristically(
  branches: ProcedureBranch[] | undefined,
  context: ProcedureExecutionContext,
  customerMessage: string,
): ProcedureBranch | null {
  if (!branches?.length) return null;
  if (branches.length === 1) return branches[0];

  const haystack = summarizeRuntimeContext(context, customerMessage);
  let best: { branch: ProcedureBranch; score: number } | null = null;

  for (const branch of branches) {
    const terms = normalizeText(branch.condition)
      .split(/\s+/)
      .filter((term) => term.length >= 3);
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    if (!best || score > best.score) {
      best = { branch, score };
    }
  }

  return best && best.score > 0 ? best.branch : null;
}

function findNextStep(
  graph: ProcedureGraph,
  currentStep: ProcedureStep,
  context: ProcedureExecutionContext,
): ProcedureStep | null {
  if (currentStep.branches?.length) {
    const branch = matchDecisionToBranch(currentStep.branches, context.decisions[currentStep.id]);
    if (branch) {
      const target = findStep(graph, branch.nextStepId);
      if (target) return target;
    }
  }

  return currentStep.nextStepId ? findStep(graph, currentStep.nextStepId) : null;
}

function missingRequiredSlots(
  requiredSlots: string[] | undefined,
  context: ProcedureExecutionContext,
): string[] {
  return (requiredSlots || []).filter((slot) => !String(context.collectedSlots[slot] || '').trim());
}

function buildMissingSlotsPrompt(slots: string[]): string {
  if (slots.length === 0) return 'Para seguir, me informe os dados solicitados.';
  const labels = slots.map((slot) => (
    isKnownAutopilotSlot(slot) ? labelSlotForCustomer(slot) : slot
  ));
  return `Para seguir, me informe: ${labels.join(', ')}.`;
}

function executeGatherDataStep(
  step: ProcedureStep,
  customerMessage: string,
  context: ProcedureExecutionContext,
  isResuming: boolean,
): StepResult {
  if (!isResuming) {
    const prompt = step.promptTemplate
      ? interpolate(step.promptTemplate, context)
      : buildMissingSlotsPrompt(missingRequiredSlots(step.requiredSlots, context));
    return { status: 'pause', response: prompt };
  }

  const missingBefore = missingRequiredSlots(step.requiredSlots, context);
  const collected: Record<string, string> = {};

  if (missingBefore.length === 0) {
    if (customerMessage.trim()) collected._response = customerMessage.trim();
    return { status: 'continue', slotCollected: collected };
  }

  const extraction = extractAutopilotSlots({ customerMessage });
  for (const slot of missingBefore) {
    if (isKnownAutopilotSlot(slot) && extraction.slots[slot]) {
      collected[slot] = String(extraction.slots[slot]);
    }
  }

  const missingAfterExtraction = missingBefore.filter((slot) => !collected[slot]);
  if (missingAfterExtraction.includes('customer_identifier')) {
    const invalidIdentifier = extraction.invalidSlots.find((slot) => slot.name === 'customer_identifier');
    if (invalidIdentifier) {
      return {
        status: 'pause',
        response: 'O CPF/CNPJ informado parece invalido. Pode enviar novamente, por favor?',
        slotCollected: collected,
      };
    }
  }

  if (missingAfterExtraction.length === 1 && customerMessage.trim()) {
    const fallbackSlot = missingAfterExtraction[0];
    if (fallbackSlot !== 'customer_identifier' || isValidCustomerIdentifier(customerMessage)) {
      collected[fallbackSlot] = customerMessage.trim();
    }
  }

  const stillMissing = missingBefore.filter((slot) => !collected[slot] && !context.collectedSlots[slot]);
  if (stillMissing.length > 0) {
    return {
      status: 'pause',
      response: step.promptTemplate
        ? interpolate(step.promptTemplate, context)
        : buildMissingSlotsPrompt(stillMissing),
      slotCollected: collected,
    };
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

  const existingResults = getToolResultsForStep(context, step.id);
  if (existingResults.length > 0) {
    return { status: 'continue', output: existingResults };
  }

  const payload: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(step.toolPayloadTemplate || {})) {
    payload[key] = interpolate(template, context);
  }

  const action: AgentToolAction = step.toolName.startsWith('mcp:')
    ? {
      type: 'mcp_call_tool',
      reason: `Procedure step: ${step.label}`,
      payload: {
        toolName: step.toolName,
        arguments: payload,
      },
    }
    : {
      type: step.toolName as any,
      reason: `Procedure step: ${step.label}`,
      payload,
    };

  return { status: 'wait_tool', action };
}

function evaluateValidation(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): { passes: boolean; reason?: string } {
  const condition = step.condition || '';
  if (!condition.trim()) return { passes: true };

  const interpolated = interpolate(condition, context);
  if (/\{\{\w+\}\}/.test(interpolated)) {
    return { passes: false, reason: `Dados ausentes para validar: ${condition}` };
  }

  const normalized = normalizeText(condition);
  const identifier = context.collectedSlots.customer_identifier;
  if (/\b(cpf|cnpj|customer_identifier|identificador|documento)\b/.test(normalized)) {
    if (!identifier || !isValidCustomerIdentifier(identifier)) {
      return { passes: false, reason: 'CPF/CNPJ ausente ou invalido.' };
    }
  }

  const expectsToolData =
    /\b(tool|ferramenta|consulta|sgp|mcp|sistema|contrato|fatura|boleto|sinal|conexao|status|sucesso)\b/.test(normalized);
  if (expectsToolData) {
    if (hasFailedToolResult(context)) {
      return { passes: false, reason: 'A ferramenta retornou erro.' };
    }
    if (!hasSuccessfulToolResult(context)) {
      return { passes: false, reason: 'Resultado de ferramenta ausente.' };
    }
  }

  return { passes: true };
}

function executeValidateStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  const validation = evaluateValidation(step, context);
  if (validation.passes) return { status: 'continue' };

  const onFail = step.onFail || 'skip';
  if (onFail === 'skip') return { status: 'continue' };
  return { status: 'error', error: validation.reason || `Validacao falhou: ${step.condition || step.label}` };
}

async function executeDecideStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  customerMessage: string,
  decisionResolver?: ProcedureDecisionResolver,
): Promise<StepResult> {
  const branches = step.branches || [];
  if (branches.length === 0) return { status: 'continue', decision: 'default' };

  const prompt = step.decisionPrompt
    ? interpolate(step.decisionPrompt, context)
    : `Escolha uma das opcoes: ${branches.map((branch) => branch.condition).join(', ')}`;

  let selectedBranch: ProcedureBranch | null = null;
  if (decisionResolver) {
    const resolved = await decisionResolver({
      step,
      context,
      customerMessage,
      branches,
      prompt,
      toolResults: getAllToolResults(context),
    });
    selectedBranch = matchDecisionToBranch(branches, resolved);
  }

  selectedBranch ||= chooseBranchHeuristically(branches, context, customerMessage);
  selectedBranch ||= branches.length === 1 ? branches[0] : null;

  return {
    status: 'continue',
    decision: selectedBranch?.condition || 'default',
  };
}

async function executeRespondStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  customerMessage: string,
  responseResolver?: ProcedureResponseResolver,
): Promise<StepResult> {
  const templateResponse = step.responseTemplate
    ? interpolate(step.responseTemplate, context)
    : '';

  if (step.useLlm && responseResolver) {
    const resolved = await responseResolver({
      step,
      context,
      customerMessage,
      prompt: templateResponse || step.label,
      toolResults: getAllToolResults(context),
    });
    return { status: 'continue', response: resolved || templateResponse || null };
  }

  return { status: 'continue', response: templateResponse || null };
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

export async function advanceProcedure(input: {
  graph: ProcedureGraph;
  context: ProcedureExecutionContext;
  customerMessage: string;
  availableTeams?: Array<{ id: string; name: string }>;
  toolResults?: AgentToolExecutionResult[];
  decisionResolver?: ProcedureDecisionResolver;
  responseResolver?: ProcedureResponseResolver;
}): Promise<ProcedureAdvanceResult> {
  const { graph, context, customerMessage } = input;
  const executedSteps: string[] = [];
  const actions: ProcedureAdvanceResult['actions'] = [];
  let responseText: string | null = null;
  let stepsExecuted = 0;
  let isResuming = context.status === 'waiting_input';

  if (input.toolResults?.length) {
    context.toolResults = context.toolResults || {};
    context.toolResults[context.currentStepId] = input.toolResults;
  }

  context.status = 'running';

  while (stepsExecuted < MAX_STEPS_PER_INVOCATION) {
    const currentStep = findStep(graph, context.currentStepId);
    if (!currentStep) {
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
          result = await executeDecideStep(currentStep, context, customerMessage, input.decisionResolver);
          break;
        case 'respond':
          result = await executeRespondStep(currentStep, context, customerMessage, input.responseResolver);
          break;
        case 'handoff':
          result = executeHandoffStep(currentStep, context);
          break;
        default:
          result = { status: 'error', error: `Tipo de passo desconhecido: ${(currentStep as ProcedureStep).type}` };
      }
    } catch (error) {
      result = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    isResuming = false;

    if (result.slotCollected) {
      Object.assign(context.collectedSlots, result.slotCollected);
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        slotCollected: result.slotCollected,
      };
    }
    if (result.decision) {
      context.decisions[currentStep.id] = result.decision;
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        decision: result.decision,
      };
    }
    if (result.output) {
      stepRecord.output = result.output;
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
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        action: result.action.type,
      };
    }

    switch (result.status) {
      case 'pause': {
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

      case 'wait_tool': {
        stepRecord.status = 'waiting_tool';
        context.status = 'waiting_tool';
        context.stepHistory.push(stepRecord);
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'waiting_tool',
          executedSteps,
        };
      }

      case 'error': {
        stepRecord.status = 'error';
        stepRecord.error = result.error;
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        const retries = context.retryCount[currentStep.id] || 0;
        const maxRetries = currentStep.maxRetries ?? 2;

        if (retries < maxRetries) {
          context.retryCount[currentStep.id] = retries + 1;
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

        context.status = 'failed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText || 'Nao consegui completar o procedimento automaticamente. Vou encaminhar para a equipe.',
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
          completionReason: 'Procedimento concluido.',
        };
      }

      case 'continue': {
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        const nextStep = findNextStep(graph, currentStep, context);
        if (nextStep) {
          context.currentStepId = nextStep.id;
          break;
        }

        context.status = 'completed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'completed',
          executedSteps,
          completionReason: 'Todos os passos concluidos.',
        };
      }
    }
  }

  await saveProcedureExecution(context);

  return {
    handled: true,
    response: responseText,
    actions,
    status: context.status,
    executedSteps,
  };
}
