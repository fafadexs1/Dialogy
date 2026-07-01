import type { Contact } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import {
  buildAutopilotTurnPlan,
  buildAutopilotTurnPlanCustomerResponse,
  buildAutopilotTurnPlanFollowUpActions,
  type AutopilotTurnPlan,
} from '@/services/autopilot/turn-plan';
import {
  isExplicitAffirmativeMessage,
  isExplicitPendingActionCancellation,
} from '@/services/autopilot/flow-state-store';

export type AutopilotConversationTurnExpectation = {
  customerNeed?: AutopilotTurnPlan['customerNeed'];
  expectedNextAction?: AutopilotTurnPlan['expectedNextAction'];
  executedToolsInclude?: string[];
  executedToolsExclude?: string[];
  responseIncludes?: string[];
  responseExcludes?: string[];
  missingInputFieldsInclude?: string[];
  pendingConfirmationTool?: string | null;
  confirmedTool?: string | null;
  maxToolExecutions?: number;
};

export type AutopilotConversationToolFixture = (input: {
  action: AgentToolAction;
  turnIndex: number;
  chatHistory: string;
  priorToolResults: AgentToolExecutionResult[];
}) => AgentToolExecutionResult;

export type AutopilotConversationScenario = {
  id: string;
  title: string;
  contact?: Contact;
  enabledToolNames: string[];
  allowedToolNames?: string[];
  toolCatalog: AgentToolCatalogItem[];
  availableTeams?: ToolRouterTeam[];
  toolFixtures: Record<string, AutopilotConversationToolFixture>;
  turns: Array<{
    customerMessage: string;
    expect?: AutopilotConversationTurnExpectation;
  }>;
};

export type AutopilotConversationTurnTrace = {
  turnIndex: number;
  customerMessage: string;
  response: string;
  turnPlan: AutopilotTurnPlan;
  executedTools: string[];
  toolResults: AgentToolExecutionResult[];
  validatorDecision: string;
  pendingConfirmationTool: string | null;
  confirmedTool: string | null;
  invariantViolations: string[];
};

export type AutopilotConversationScenarioResult = {
  id: string;
  title: string;
  passed: boolean;
  turns: AutopilotConversationTurnTrace[];
  invariantViolations: string[];
  assertionsPassed: number;
  assertionsTotal: number;
  qualityScore: number;
};

export type AutopilotConversationSuiteRequirements = {
  minimumQualityScore?: number;
  customerNeeds?: AutopilotTurnPlan['customerNeed'][];
  executedToolNames?: string[];
};

export type AutopilotConversationSuiteResult = {
  passed: boolean;
  scenarioCount: number;
  turnCount: number;
  scenarios: AutopilotConversationScenarioResult[];
  assertionsPassed: number;
  assertionsTotal: number;
  qualityScore: number;
  coveredCustomerNeeds: AutopilotTurnPlan['customerNeed'][];
  coveredToolNames: string[];
  violations: string[];
};

function actionToolName(action: AgentToolAction): string {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '')
    : action.type;
}

function actionKey(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') {
    return `${action.payload?.toolName || action.type}:${JSON.stringify(action.payload?.arguments || {})}`;
  }
  return `${action.type}:${JSON.stringify(action.payload || {})}`;
}

function executeActions(input: {
  actions: AgentToolAction[];
  scenario: AutopilotConversationScenario;
  turnIndex: number;
  chatHistory: string;
  priorToolResults: AgentToolExecutionResult[];
}): AgentToolExecutionResult[] {
  return input.actions.map((action) => {
    const toolName = actionToolName(action);
    const fixture = input.scenario.toolFixtures[toolName] || input.scenario.toolFixtures[action.type];
    if (!fixture) {
      return {
        toolName: toolName as AgentToolExecutionResult['toolName'],
        status: 'error',
        input: action,
        error: `Fixture ausente para ferramenta ${toolName}.`,
      };
    }
    return fixture({
      action,
      turnIndex: input.turnIndex,
      chatHistory: input.chatHistory,
      priorToolResults: input.priorToolResults,
    });
  });
}

function buildInvariantViolations(input: {
  turnPlan: AutopilotTurnPlan;
  executedActions: AgentToolAction[];
  previousExecutedActionKeys: string[];
  confirmedActionKey?: string | null;
}): string[] {
  const executedToolNames = input.executedActions.map(actionToolName);
  const violations: string[] = [];
  const forbidden = input.turnPlan.forbiddenToolNames.filter((toolName) => executedToolNames.includes(toolName));
  if (forbidden.length > 0) {
    violations.push(`forbidden_tools_executed:${forbidden.join(',')}`);
  }

  if (
    input.turnPlan.expectedNextAction === 'call_required_tool' &&
    input.turnPlan.preResponseActions.length > 0
  ) {
    const plannedCurrentTools = input.turnPlan.preResponseActions.map(actionToolName);
    const missingRequired = plannedCurrentTools.filter((toolName) => !executedToolNames.includes(toolName));
    if (missingRequired.length > 0) {
      violations.push(`required_tools_missing:${missingRequired.join(',')}`);
    }
  }

  const currentKeys = input.executedActions.map(actionKey);
  const repeatedKeys = currentKeys.filter((key) => (
    input.previousExecutedActionKeys.includes(key) &&
    key !== input.confirmedActionKey
  ));
  if (repeatedKeys.length > 0 && input.turnPlan.expectedNextAction !== 'respond_from_tool_result') {
    violations.push(`repeated_tool_without_progress:${[...new Set(repeatedKeys)].join(',')}`);
  }

  return violations;
}

function normalizeExpectationText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildExpectationViolations(input: {
  expectation?: AutopilotConversationTurnExpectation;
  trace: Omit<AutopilotConversationTurnTrace, 'invariantViolations'>;
}): { violations: string[]; assertions: number } {
  const expectation = input.expectation;
  if (!expectation) return { violations: [], assertions: 0 };
  const violations: string[] = [];
  let assertions = 0;
  const assert = (condition: boolean, code: string) => {
    assertions += 1;
    if (!condition) violations.push(code);
  };

  if (expectation.customerNeed != null) {
    assert(input.trace.turnPlan.customerNeed === expectation.customerNeed, `expected_customer_need:${expectation.customerNeed}`);
  }
  if (expectation.expectedNextAction != null) {
    assert(input.trace.turnPlan.expectedNextAction === expectation.expectedNextAction, `expected_next_action:${expectation.expectedNextAction}`);
  }
  for (const toolName of expectation.executedToolsInclude || []) {
    assert(input.trace.executedTools.includes(toolName), `expected_tool_missing:${toolName}`);
  }
  for (const toolName of expectation.executedToolsExclude || []) {
    assert(!input.trace.executedTools.includes(toolName), `forbidden_tool_present:${toolName}`);
  }
  const normalizedResponse = normalizeExpectationText(input.trace.response);
  for (const text of expectation.responseIncludes || []) {
    assert(normalizedResponse.includes(normalizeExpectationText(text)), `response_missing:${text}`);
  }
  for (const text of expectation.responseExcludes || []) {
    assert(!normalizedResponse.includes(normalizeExpectationText(text)), `response_forbidden:${text}`);
  }
  for (const fieldName of expectation.missingInputFieldsInclude || []) {
    assert(
      input.trace.turnPlan.missingInputFields.some((field) => field.name === fieldName),
      `missing_input_field_not_collected:${fieldName}`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(expectation, 'pendingConfirmationTool')) {
    assert(
      input.trace.pendingConfirmationTool === expectation.pendingConfirmationTool,
      `pending_confirmation_mismatch:${expectation.pendingConfirmationTool ?? 'null'}`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(expectation, 'confirmedTool')) {
    assert(
      input.trace.confirmedTool === expectation.confirmedTool,
      `confirmed_tool_mismatch:${expectation.confirmedTool ?? 'null'}`,
    );
  }
  if (expectation.maxToolExecutions != null) {
    assert(input.trace.executedTools.length <= expectation.maxToolExecutions, `too_many_tool_executions:${input.trace.executedTools.length}`);
  }

  return { violations, assertions };
}

export function runAutopilotConversationScenario(
  scenario: AutopilotConversationScenario
): AutopilotConversationScenarioResult {
  const contact: Contact = scenario.contact || {
    id: `${scenario.id}-contact`,
    workspace_id: 'eval-workspace',
    name: 'Cliente Eval',
  };
  const availableTeams = scenario.availableTeams || [];
  const chatHistoryLines: string[] = [];
  const recentToolResults: AgentToolExecutionResult[] = [];
  const turns: AutopilotConversationTurnTrace[] = [];
  let previousExecutedActionKeys: string[] = [];
  let pendingConfirmation: { action: AgentToolAction; turnPlan: AutopilotTurnPlan } | null = null;
  let assertionsTotal = 0;
  let assertionsPassed = 0;

  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const chatHistory = chatHistoryLines.join('\n');
    const intentResolution = resolveAutopilotIntent({
      customerMessage: turn.customerMessage,
      chatHistory,
    });
    const slotExtraction = extractAutopilotSlots({
      customerMessage: turn.customerMessage,
      chatHistory,
      contact,
    });
    const executedActions: AgentToolAction[] = [];
    let toolResults: AgentToolExecutionResult[] = [];
    let response = '';
    let confirmedTool: string | null = null;
    let confirmedActionKey: string | null = null;
    let turnPlan: AutopilotTurnPlan;

    if (pendingConfirmation && isExplicitAffirmativeMessage(turn.customerMessage)) {
      const confirmed = pendingConfirmation;
      pendingConfirmation = null;
      confirmedTool = actionToolName(confirmed.action);
      confirmedActionKey = actionKey(confirmed.action);
      turnPlan = {
        ...confirmed.turnPlan,
        expectedNextAction: 'respond_from_tool_result',
        metadata: {
          ...confirmed.turnPlan.metadata,
          confirmedPendingAction: confirmedTool,
        },
      };
      executedActions.push(confirmed.action);
      toolResults = executeActions({
        actions: [confirmed.action],
        scenario,
        turnIndex,
        chatHistory,
        priorToolResults: recentToolResults,
      });
      recentToolResults.push(...toolResults);
      response = buildAutopilotTurnPlanCustomerResponse({
        turnPlan,
        toolResults,
      }) || (
        toolResults.some((result) => result.status === 'success')
          ? 'Pronto, a acao confirmada foi executada com sucesso.'
          : 'Nao consegui executar a acao confirmada e nao vou repeti-la automaticamente.'
      );
    } else if (pendingConfirmation && isExplicitPendingActionCancellation(turn.customerMessage)) {
      turnPlan = {
        ...pendingConfirmation.turnPlan,
        expectedNextAction: 'continue_llm',
        preResponseActions: [],
        responseOverride: 'Tudo bem. A acao pendente foi cancelada e nao sera executada.',
        metadata: {
          ...pendingConfirmation.turnPlan.metadata,
          pendingActionCancelled: true,
        },
      };
      pendingConfirmation = null;
      response = turnPlan.responseOverride || 'Tudo bem. A acao pendente foi cancelada e nao sera executada.';
    } else {
      if (pendingConfirmation) pendingConfirmation = null;
      turnPlan = buildAutopilotTurnPlan({
        customerMessage: turn.customerMessage,
        chatHistory,
        intentResolution,
        slotExtraction,
        enabledToolNames: scenario.enabledToolNames,
        allowedToolNames: scenario.allowedToolNames || scenario.enabledToolNames,
        toolCatalog: scenario.toolCatalog,
        recentToolResults,
      });
      response = turnPlan.responseOverride || '';

      if (!response && turnPlan.preResponseActions.length > 0) {
        executedActions.push(...turnPlan.preResponseActions);
        toolResults = executeActions({
          actions: turnPlan.preResponseActions,
          scenario,
          turnIndex,
          chatHistory,
          priorToolResults: recentToolResults,
        });
        recentToolResults.push(...toolResults);

        const confirmationResult = toolResults.find((result) => (
          result.status === 'rejected' &&
          result.error?.includes('[tool_policy:confirmation_required]')
        ));
        if (confirmationResult) {
          const action = executedActions.find((candidate) => (
            actionKey(candidate) === actionKey(confirmationResult.input)
          )) || confirmationResult.input;
          pendingConfirmation = { action, turnPlan };
        }

        const followUpActions = buildAutopilotTurnPlanFollowUpActions({
          turnPlan,
          customerMessage: turn.customerMessage,
          enabledToolNames: scenario.enabledToolNames,
          allowedToolNames: scenario.allowedToolNames || scenario.enabledToolNames,
          toolCatalog: scenario.toolCatalog,
          toolResults,
        });
        if (followUpActions.length > 0) {
          executedActions.push(...followUpActions);
          const followUpResults = executeActions({
            actions: followUpActions,
            scenario,
            turnIndex,
            chatHistory,
            priorToolResults: recentToolResults,
          });
          toolResults = [...toolResults, ...followUpResults];
          recentToolResults.push(...followUpResults);
        }

        const postToolTurnPlan = buildAutopilotTurnPlan({
          customerMessage: turn.customerMessage,
          chatHistory,
          intentResolution,
          slotExtraction,
          enabledToolNames: scenario.enabledToolNames,
          allowedToolNames: scenario.allowedToolNames || scenario.enabledToolNames,
          toolCatalog: scenario.toolCatalog,
          recentToolResults,
        });
        if (
          !confirmationResult
          &&
          postToolTurnPlan.responseOverride
          && postToolTurnPlan.preResponseActions.length === 0
        ) {
          turnPlan = postToolTurnPlan;
          response = postToolTurnPlan.responseOverride;
        } else {
          response = buildAutopilotTurnPlanCustomerResponse({
            turnPlan,
            toolResults,
          }) || 'Nao consegui concluir a consulta automatica agora. Vou precisar verificar manualmente.';
        }
      }
    }

    if (
      !pendingConfirmation
      && turnPlan.expectedNextAction === 'require_confirmation'
      && turnPlan.confirmationAction
      && executedActions.length === 0
    ) {
      pendingConfirmation = {
        action: turnPlan.confirmationAction,
        turnPlan,
      };
    }

    if (!response) {
      response = 'Entendi. Vou seguir com a proxima etapa do atendimento.';
    }

    const validator = validateAutopilotResponse({
      response,
      fallbackReply: 'Fallback configurado para avaliacao.',
      customerMessage: turn.customerMessage,
      chatHistory,
      continuationRequiredSlots: turnPlan.missingSlots,
      intentResolution,
      slotExtraction,
      plannedActions: executedActions,
      toolResults,
      enabledToolNames: scenario.enabledToolNames,
      availableTeams,
      contact,
      knowledgeCoverage: 'medium',
      source: toolResults.length > 0 ? 'workflow_tools' : 'workflow_direct',
    });
    response = validator.response;

    const invariantViolations = buildInvariantViolations({
      turnPlan,
      executedActions,
      previousExecutedActionKeys,
      confirmedActionKey,
    });
    previousExecutedActionKeys = executedActions.map(actionKey);

    const traceWithoutViolations: Omit<AutopilotConversationTurnTrace, 'invariantViolations'> = {
      turnIndex,
      customerMessage: turn.customerMessage,
      response,
      turnPlan,
      executedTools: executedActions.map(actionToolName),
      toolResults,
      validatorDecision: validator.decision,
      pendingConfirmationTool: pendingConfirmation ? actionToolName(pendingConfirmation.action) : null,
      confirmedTool,
    };
    const expectationResult = buildExpectationViolations({
      expectation: turn.expect,
      trace: traceWithoutViolations,
    });
    assertionsTotal += expectationResult.assertions;
    assertionsPassed += expectationResult.assertions - expectationResult.violations.length;
    turns.push({
      ...traceWithoutViolations,
      invariantViolations: [...invariantViolations, ...expectationResult.violations],
    });

    chatHistoryLines.push(`Cliente: ${turn.customerMessage}`);
    chatHistoryLines.push(`Atendente: ${response}`);
  }

  const invariantViolations = turns.flatMap((turn) => turn.invariantViolations.map((violation) => (
    `turn_${turn.turnIndex}:${violation}`
  )));

  return {
    id: scenario.id,
    title: scenario.title,
    passed: invariantViolations.length === 0,
    turns,
    invariantViolations,
    assertionsPassed,
    assertionsTotal,
    qualityScore: assertionsTotal === 0 ? (invariantViolations.length === 0 ? 1 : 0) : assertionsPassed / assertionsTotal,
  };
}

export function runAutopilotConversationSuite(input: {
  scenarios: AutopilotConversationScenario[];
  requirements?: AutopilotConversationSuiteRequirements;
}): AutopilotConversationSuiteResult {
  const scenarios = input.scenarios.map(runAutopilotConversationScenario);
  const assertionsPassed = scenarios.reduce((sum, scenario) => sum + scenario.assertionsPassed, 0);
  const assertionsTotal = scenarios.reduce((sum, scenario) => sum + scenario.assertionsTotal, 0);
  const coveredCustomerNeeds = [...new Set(
    scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.turnPlan.customerNeed)),
  )];
  const coveredToolNames = [...new Set(
    scenarios.flatMap((scenario) => scenario.turns.flatMap((turn) => turn.executedTools)),
  )].sort();
  const qualityScore = assertionsTotal === 0
    ? (scenarios.every((scenario) => scenario.passed) ? 1 : 0)
    : assertionsPassed / assertionsTotal;
  const minimumQualityScore = input.requirements?.minimumQualityScore ?? 1;
  const violations = scenarios.flatMap((scenario) => (
    scenario.invariantViolations.map((violation) => `${scenario.id}:${violation}`)
  ));

  for (const customerNeed of input.requirements?.customerNeeds || []) {
    if (!coveredCustomerNeeds.includes(customerNeed)) {
      violations.push(`coverage_missing_customer_need:${customerNeed}`);
    }
  }
  for (const toolName of input.requirements?.executedToolNames || []) {
    if (!coveredToolNames.includes(toolName)) {
      violations.push(`coverage_missing_executed_tool:${toolName}`);
    }
  }
  if (qualityScore < minimumQualityScore) {
    violations.push(`quality_score_below_threshold:${qualityScore.toFixed(4)}<${minimumQualityScore.toFixed(4)}`);
  }

  return {
    passed: scenarios.every((scenario) => scenario.passed) && violations.length === 0,
    scenarioCount: scenarios.length,
    turnCount: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
    scenarios,
    assertionsPassed,
    assertionsTotal,
    qualityScore,
    coveredCustomerNeeds,
    coveredToolNames,
    violations,
  };
}
