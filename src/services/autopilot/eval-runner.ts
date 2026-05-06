import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import type { AgentToolName } from '@/services/agent-tools/types';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { mergeAndRerankKnowledgeDocuments } from '@/services/rag/hybrid-retrieval';
import { extractAutopilotSlots } from './slots';
import { planAutopilotTools } from './tool-planner';
import { validateAutopilotResponse } from './response-validator';
import { resolveAutopilotWorkflowPlan } from './workflow-engine';
import type { KnowledgeCoverage } from './intent-types';
import {
  AUTOPILOT_OFFLINE_EVAL_CASES,
  DEFAULT_EVAL_CONTACT,
  DEFAULT_EVAL_DOCUMENTS,
  DEFAULT_EVAL_ENABLED_TOOLS,
  DEFAULT_EVAL_TEAMS,
  type AutopilotEvalCase,
} from './eval-cases';
import {
  buildAutopilotObservation,
  summarizeAutopilotObservations,
  type AutopilotObservation,
  type AutopilotObservationSummary,
} from './observability';

type EvalDimension = 'intent' | 'rag' | 'workflow' | 'tool_planner' | 'validator' | 'response';

export type AutopilotEvalCheck = {
  dimension: EvalDimension;
  passed: boolean;
  message: string;
};

export type AutopilotEvalCaseResult = {
  id: string;
  title: string;
  vertical: string;
  passed: boolean;
  checks: AutopilotEvalCheck[];
  failures: string[];
  actual: {
    intent: string;
    confidence: number;
    ragStrategy: string;
    knowledgeCoverage: KnowledgeCoverage;
    ragTopDocumentId: string | null;
    workflowExecutionMode: string;
    workflowHandled: boolean;
    missingSlots: string[];
    acceptedTools: string[];
    rejectedToolCodes: string[];
    validatorDecision: string;
    finalResponse: string;
    handoffPlanned: boolean;
  };
  observation: AutopilotObservation;
};

export type AutopilotEvalSummary = AutopilotObservationSummary & {
  passed: number;
  failed: number;
  score: number;
  intentAccuracy: number;
  ragPassRate: number;
  workflowPassRate: number;
  toolPlannerPassRate: number;
  validatorPassRate: number;
  responsePassRate: number;
  unexpectedFallbackRate: number;
};

export type AutopilotEvalReport = {
  mode: 'offline';
  generatedAt: string;
  summary: AutopilotEvalSummary;
  results: AutopilotEvalCaseResult[];
  failures: Array<{
    id: string;
    title: string;
    failures: string[];
  }>;
};

const COVERAGE_RANK: Record<KnowledgeCoverage, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAll<T extends string>(actual: T[] | string[], expected: T[] | string[] | undefined) {
  if (!expected || expected.length === 0) return true;
  const actualSet = new Set(actual.map(String));
  return expected.every((item) => actualSet.has(String(item)));
}

function coverageAtLeast(actual: KnowledgeCoverage, expected?: KnowledgeCoverage) {
  if (!expected) return true;
  return COVERAGE_RANK[actual] >= COVERAGE_RANK[expected];
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function checkPassRate(results: AutopilotEvalCaseResult[], dimension: EvalDimension) {
  const checks = results.flatMap((result) => result.checks.filter((check) => check.dimension === dimension));
  return ratio(checks.filter((check) => check.passed).length, checks.length);
}

function defaultResponseForCase(input: {
  evalCase: AutopilotEvalCase;
  officialResponse?: string | null;
  workflowResponse?: string | null;
}) {
  if (input.evalCase.simulatedResponse != null) return input.evalCase.simulatedResponse;
  return input.workflowResponse ||
    input.officialResponse ||
    'Entendi. Para responder com seguranca, preciso de mais detalhes sobre o que voce precisa.';
}

function fallbackExpected(evalCase: AutopilotEvalCase) {
  return Boolean(evalCase.expected.allowFallback) ||
    evalCase.expected.validatorDecision === 'replace_with_fallback' ||
    evalCase.expected.validatorDecision === 'handoff' ||
    Boolean(evalCase.expected.rejectedToolCodes?.length);
}

function runOfflineAutopilotEvalCase(evalCase: AutopilotEvalCase): AutopilotEvalCaseResult {
  const knowledgeDocuments = evalCase.knowledgeDocuments || DEFAULT_EVAL_DOCUMENTS;
  const enabledToolNames = evalCase.enabledToolNames || DEFAULT_EVAL_ENABLED_TOOLS;
  const availableTeams = evalCase.availableTeams || DEFAULT_EVAL_TEAMS;
  const contact = evalCase.contact || DEFAULT_EVAL_CONTACT;
  const intentResolution = resolveAutopilotIntent({
    customerMessage: evalCase.customerMessage,
    chatHistory: evalCase.chatHistory || '',
    knowledgeDocuments,
  });
  const rag = mergeAndRerankKnowledgeDocuments({
    staticDocuments: knowledgeDocuments,
    query: evalCase.customerMessage,
    intent: intentResolution,
  });
  const workflowPlan = resolveAutopilotWorkflowPlan({
    intentResolution,
    customerMessage: evalCase.customerMessage,
    chatHistory: evalCase.chatHistory || '',
    contact,
    enabledToolNames,
    availableTeams,
    knowledgeCoverage: rag.knowledgeCoverage,
    slotMappings: { customerIdentifierFieldKeys: ['CPF'] },
    now: new Date(2026, 4, 5),
  });
  const slotExtraction = extractAutopilotSlots({
    customerMessage: evalCase.customerMessage,
    chatHistory: evalCase.chatHistory || '',
    contact,
    now: new Date(2026, 4, 5),
  });
  const responseBeforePlanner = defaultResponseForCase({
    evalCase,
    officialResponse: intentResolution.officialResponse,
    workflowResponse: workflowPlan.response,
  });
  const initialActions = evalCase.simulatedActions !== undefined
    ? evalCase.simulatedActions
    : workflowPlan.executionMode === 'continue_llm'
      ? []
      : workflowPlan.actions;
  const toolPlanner = planAutopilotTools({
    response: responseBeforePlanner,
    customerMessage: evalCase.customerMessage,
    intentResolution,
    slotExtraction,
    actions: initialActions,
    enabledToolNames,
    toolCatalog: listAgentToolCatalogItems(),
    availableTeams,
    contact,
  });
  const responseAfterPlanner = toolPlanner.responseOverride || responseBeforePlanner;
  const responseValidator = validateAutopilotResponse({
    response: responseAfterPlanner,
    fallbackReply: 'Fallback configurado para eval.',
    customerMessage: evalCase.customerMessage,
    intentResolution,
    slotExtraction,
    plannedActions: toolPlanner.actions,
    toolResults: evalCase.simulatedToolResults || [],
    enabledToolNames,
    availableTeams,
    contact,
    knowledgeCoverage: rag.knowledgeCoverage,
    source: workflowPlan.handledByWorkflow ? 'workflow_direct' : 'llm',
  });
  const finalResponse = responseValidator.response;
  const acceptedTools = toolPlanner.actions.map((action) => {
    if (action.type === 'mcp_call_tool') return action.payload?.toolName || action.type;
    return action.type;
  });
  const rejectedToolCodes = toolPlanner.rejectedActions.map((item) => item.code);
  const allActions = [
    ...workflowPlan.actions,
    ...toolPlanner.actions,
    ...responseValidator.actions,
  ];
  const handoffPlanned = allActions.some((action) => action.type === 'transfer_chat');
  const observedFallback = Boolean(toolPlanner.responseOverride) ||
    toolPlanner.rejectedActions.length > 0 ||
    responseValidator.decision === 'replace_with_fallback';
  const fallbackReason = responseValidator.reasons[0] ||
    toolPlanner.promiseValidation.repairReason ||
    toolPlanner.rejectedActions[0]?.code ||
    null;
  const observation = buildAutopilotObservation({
    caseId: evalCase.id,
    status: observedFallback ? 'fallback' : 'success',
    responseSent: true,
    intentResolution,
    ragStrategy: rag.strategy,
    knowledgeCoverage: rag.knowledgeCoverage,
    workflowPlan,
    toolPlanner,
    responseValidator,
    toolResults: evalCase.simulatedToolResults || [],
    fallbackReason,
  });
  const topDocumentId = rag.knowledgeBaseDocuments[0]?.id || null;
  const checks: AutopilotEvalCheck[] = [];
  const addCheck = (dimension: EvalDimension, passed: boolean, message: string) => {
    checks.push({ dimension, passed, message });
  };

  addCheck(
    'intent',
    intentResolution.intent === evalCase.expected.intent,
    `Intent esperado ${evalCase.expected.intent}, recebido ${intentResolution.intent}.`
  );
  if (evalCase.expected.ragCoverageAtLeast) {
    addCheck(
      'rag',
      coverageAtLeast(rag.knowledgeCoverage, evalCase.expected.ragCoverageAtLeast),
      `Coverage esperado >= ${evalCase.expected.ragCoverageAtLeast}, recebido ${rag.knowledgeCoverage}.`
    );
  }
  if (evalCase.expected.ragTopDocumentId) {
    addCheck(
      'rag',
      topDocumentId === evalCase.expected.ragTopDocumentId,
      `Top doc esperado ${evalCase.expected.ragTopDocumentId}, recebido ${topDocumentId || 'none'}.`
    );
  }
  if (evalCase.expected.workflowExecutionMode) {
    addCheck(
      'workflow',
      workflowPlan.executionMode === evalCase.expected.workflowExecutionMode,
      `Workflow esperado ${evalCase.expected.workflowExecutionMode}, recebido ${workflowPlan.executionMode}.`
    );
  }
  if (evalCase.expected.workflowHandled !== undefined) {
    addCheck(
      'workflow',
      workflowPlan.handledByWorkflow === evalCase.expected.workflowHandled,
      `Workflow handled esperado ${evalCase.expected.workflowHandled}, recebido ${workflowPlan.handledByWorkflow}.`
    );
  }
  if (evalCase.expected.missingSlots) {
    addCheck(
      'workflow',
      containsAll(workflowPlan.missingSlots, evalCase.expected.missingSlots),
      `Slots ausentes esperados ${evalCase.expected.missingSlots.join(', ')}, recebidos ${workflowPlan.missingSlots.join(', ') || 'none'}.`
    );
  }
  if (evalCase.expected.acceptedTools) {
    addCheck(
      'tool_planner',
      containsAll(acceptedTools, evalCase.expected.acceptedTools),
      `Tools aceitas esperadas ${evalCase.expected.acceptedTools.join(', ')}, recebidas ${acceptedTools.join(', ') || 'none'}.`
    );
  }
  if (evalCase.expected.rejectedToolCodes) {
    addCheck(
      'tool_planner',
      containsAll(rejectedToolCodes, evalCase.expected.rejectedToolCodes),
      `Rejeicoes esperadas ${evalCase.expected.rejectedToolCodes.join(', ')}, recebidas ${rejectedToolCodes.join(', ') || 'none'}.`
    );
  }
  if (evalCase.expected.validatorDecision) {
    addCheck(
      'validator',
      responseValidator.decision === evalCase.expected.validatorDecision,
      `Validator esperado ${evalCase.expected.validatorDecision}, recebido ${responseValidator.decision}.`
    );
  }
  if (evalCase.expected.responseIncludes) {
    const normalizedResponse = normalize(finalResponse);
    for (const requiredText of evalCase.expected.responseIncludes) {
      addCheck(
        'response',
        normalizedResponse.includes(normalize(requiredText)),
        `Resposta deve conter "${requiredText}".`
      );
    }
  }
  if (evalCase.expected.expectedHandoff !== undefined) {
    addCheck(
      'tool_planner',
      handoffPlanned === evalCase.expected.expectedHandoff,
      `Handoff esperado ${evalCase.expected.expectedHandoff}, recebido ${handoffPlanned}.`
    );
  }
  addCheck(
    'response',
    fallbackExpected(evalCase) || !observedFallback,
    observedFallback ? 'Fallback observado e esperado.' : 'Fallback nao observado.'
  );

  const failures = checks.filter((check) => !check.passed).map((check) => check.message);

  return {
    id: evalCase.id,
    title: evalCase.title,
    vertical: evalCase.vertical,
    passed: failures.length === 0,
    checks,
    failures,
    actual: {
      intent: intentResolution.intent,
      confidence: intentResolution.confidence,
      ragStrategy: rag.strategy,
      knowledgeCoverage: rag.knowledgeCoverage,
      ragTopDocumentId: topDocumentId,
      workflowExecutionMode: workflowPlan.executionMode,
      workflowHandled: workflowPlan.handledByWorkflow,
      missingSlots: workflowPlan.missingSlots,
      acceptedTools,
      rejectedToolCodes,
      validatorDecision: responseValidator.decision,
      finalResponse,
      handoffPlanned,
    },
    observation,
  };
}

export function runOfflineAutopilotEvals(
  evalCases: AutopilotEvalCase[] = AUTOPILOT_OFFLINE_EVAL_CASES
): AutopilotEvalReport {
  const results = evalCases.map(runOfflineAutopilotEvalCase);
  const observations = results.map((result) => result.observation);
  const observationSummary = summarizeAutopilotObservations(observations);
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const unexpectedFallbacks = results.filter((result, index) => (
    observations[index].status === 'fallback' && !fallbackExpected(evalCases[index])
  )).length;
  const summary: AutopilotEvalSummary = {
    ...observationSummary,
    passed,
    failed,
    score: ratio(passed, results.length),
    intentAccuracy: ratio(
      results.filter((result, index) => result.actual.intent === evalCases[index].expected.intent).length,
      results.length
    ),
    ragPassRate: checkPassRate(results, 'rag'),
    workflowPassRate: checkPassRate(results, 'workflow'),
    toolPlannerPassRate: checkPassRate(results, 'tool_planner'),
    validatorPassRate: checkPassRate(results, 'validator'),
    responsePassRate: checkPassRate(results, 'response'),
    unexpectedFallbackRate: ratio(unexpectedFallbacks, results.length),
  };

  return {
    mode: 'offline',
    generatedAt: new Date().toISOString(),
    summary,
    results,
    failures: results
      .filter((result) => !result.passed)
      .map((result) => ({
        id: result.id,
        title: result.title,
        failures: result.failures,
      })),
  };
}
