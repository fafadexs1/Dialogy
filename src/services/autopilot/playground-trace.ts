import type { Contact, KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import {
  mergeAndRerankKnowledgeDocuments,
  type KnowledgeDocumentSelectionSource,
} from '@/services/rag/hybrid-retrieval';
import { planAutopilotTools } from './tool-planner';
import { validateAutopilotResponse } from './response-validator';
import { resolveAutopilotWorkflowPlan } from './workflow-engine';

export type AutopilotPlaygroundTrace = {
  finalResponse: string;
  intent: {
    intent: string;
    confidence: number;
    reason: string;
    workflowId: string;
    requiredSlots: string[];
    extractedSlots: Record<string, string>;
    shouldUseTool: boolean;
    shouldRetrieveKnowledge: boolean;
    shouldTransfer: boolean;
  };
  rag: {
    strategy: string;
    knowledgeCoverage: string;
    selected: Array<{
      id: string;
      name: string;
      category: string;
      score: number;
      source: KnowledgeDocumentSelectionSource;
    }>;
    discardedCount: number;
  };
  workflow: {
    executionMode: string;
    handledByWorkflow: boolean;
    reason: string;
    missingSlots: string[];
    actions: string[];
  };
  toolPlanner: {
    acceptedActions: string[];
    rejectedActions: Array<{
      tool: string;
      code: string;
      reason: string;
      missingSlots: string[];
    }>;
    promisedExternalLookup: boolean;
    hasExecutableLookupTool: boolean;
    repairReason: string | null;
    responseOverride: string | null;
  };
  validator: {
    decision: string;
    reasons: string[];
    actions: string[];
  };
  ragDiagnostics?: Record<string, unknown> | null;
  procedure?: {
    enabled: boolean;
    compiledCount: number;
    active: boolean;
    procedureId: string | null;
    procedureName: string | null;
    status: string | null;
    matchScore: number | null;
    matchReason: string | null;
    executedSteps: string[];
    actions: string[];
    completionReason: string | null;
  };
};

function actionName(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') return action.payload?.toolName || action.type;
  return action.type;
}

function compactResponse(value: string | null | undefined, fallbackReply: string | null | undefined): string {
  const response = value?.trim();
  if (response) return response;
  return fallbackReply?.trim() || 'Nao consegui montar uma resposta segura para este teste.';
}

export function buildAutopilotPlaygroundTrace(input: {
  customerMessage: string;
  chatHistory?: string | null;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
  vectorKnowledgeDocuments?: KnowledgeBaseDocument[] | null;
  staticKnowledgeDocuments?: KnowledgeBaseDocument[] | null;
  fallbackReply?: string | null;
  modelResponse?: string | null;
  modelActions?: AgentToolAction[] | null;
  preferModelResponse?: boolean;
  systemAgentName?: string | null;
  contact: Contact;
  enabledToolNames: string[];
  toolCatalog: AgentToolCatalogItem[];
  availableTeams: ToolRouterTeam[];
}): AutopilotPlaygroundTrace {
  const knowledgeDocuments = input.knowledgeDocuments || [];
  const intentResolution = resolveAutopilotIntent({
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory || '',
    knowledgeDocuments,
  });
  const rag = mergeAndRerankKnowledgeDocuments({
    vectorDocuments: input.vectorKnowledgeDocuments || [],
    staticDocuments: input.staticKnowledgeDocuments || knowledgeDocuments,
    query: input.customerMessage,
    intent: intentResolution,
  });
  const workflowPlan = resolveAutopilotWorkflowPlan({
    intentResolution,
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory || '',
    contact: input.contact,
    enabledToolNames: input.enabledToolNames,
    availableTeams: input.availableTeams,
    knowledgeCoverage: rag.knowledgeCoverage,
  });
  const responseBeforePlanner = compactResponse(
    input.preferModelResponse
      ? input.modelResponse || workflowPlan.response
      : workflowPlan.response || input.modelResponse,
    input.fallbackReply,
  );
  const modelActions = input.modelActions || [];
  const candidateActions = workflowPlan.executionMode === 'continue_llm'
    ? modelActions
    : [...workflowPlan.actions, ...modelActions];
  const toolPlanner = planAutopilotTools({
    response: responseBeforePlanner,
    customerMessage: input.customerMessage,
    intentResolution,
    slotExtraction: workflowPlan.slotExtraction,
    actions: candidateActions,
    enabledToolNames: input.enabledToolNames,
    toolCatalog: input.toolCatalog,
    availableTeams: input.availableTeams,
    contact: input.contact,
  });
  const responseAfterPlanner = toolPlanner.responseOverride || responseBeforePlanner;
  const validator = validateAutopilotResponse({
    response: responseAfterPlanner,
    fallbackReply: input.fallbackReply || '',
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory || '',
    continuationRequiredSlots: workflowPlan.missingSlots,
    intentResolution,
    slotExtraction: workflowPlan.slotExtraction,
    plannedActions: toolPlanner.actions,
    toolResults: [],
    enabledToolNames: input.enabledToolNames,
    availableTeams: input.availableTeams,
    contact: input.contact,
    knowledgeCoverage: rag.knowledgeCoverage,
    knowledgeDocuments: rag.knowledgeBaseDocuments,
    source: workflowPlan.handledByWorkflow ? 'workflow_direct' : 'llm',
    systemAgentName: input.systemAgentName || undefined,
  });

  return {
    finalResponse: validator.response,
    intent: {
      intent: intentResolution.intent,
      confidence: intentResolution.confidence,
      reason: intentResolution.reason,
      workflowId: intentResolution.workflowId,
      requiredSlots: intentResolution.requiredSlots,
      extractedSlots: intentResolution.extractedSlots as Record<string, string>,
      shouldUseTool: intentResolution.shouldUseTool,
      shouldRetrieveKnowledge: intentResolution.shouldRetrieveKnowledge,
      shouldTransfer: intentResolution.shouldTransfer,
    },
    rag: {
      strategy: rag.strategy,
      knowledgeCoverage: rag.knowledgeCoverage,
      selected: rag.selected,
      discardedCount: rag.discarded.length,
    },
    workflow: {
      executionMode: workflowPlan.executionMode,
      handledByWorkflow: workflowPlan.handledByWorkflow,
      reason: workflowPlan.reason,
      missingSlots: workflowPlan.missingSlots,
      actions: workflowPlan.actions.map(actionName),
    },
    toolPlanner: {
      acceptedActions: toolPlanner.actions.map(actionName),
      rejectedActions: toolPlanner.rejectedActions.map((item) => ({
        tool: actionName(item.action),
        code: item.code,
        reason: item.reason,
        missingSlots: item.missingSlots || [],
      })),
      promisedExternalLookup: toolPlanner.promiseValidation.promisedExternalLookup,
      hasExecutableLookupTool: toolPlanner.promiseValidation.hasExecutableLookupTool,
      repairReason: toolPlanner.promiseValidation.repairReason || null,
      responseOverride: toolPlanner.responseOverride || null,
    },
    validator: {
      decision: validator.decision,
      reasons: validator.reasons,
      actions: validator.actions.map(actionName),
    },
  };
}
