/**
 * Shared shape of an AI copilot suggestion.
 *
 * Kept free of server imports so the inbox UI and the orchestrator can agree on the
 * same contract without pulling the database into the client bundle.
 */

export type CopilotSuggestionStatus = 'pending' | 'sent' | 'edited' | 'dismissed' | 'superseded';

export type CopilotSuggestionStage =
  | 'studio_copilot'
  | 'deterministic_routing'
  | 'flow_message'
  | 'tool_memory'
  | 'workflow_response'
  | 'post_tool_response'
  | 'procedure_runtime'
  | 'model_response'
  | 'fallback';

export type CopilotKnowledgeSource = {
  id?: string | null;
  name: string;
  kind?: 'document' | 'case' | 'history' | 'procedure';
  similarity?: number | null;
};

export type CopilotToolTrace = {
  name: string;
  displayName?: string | null;
  status: 'success' | 'error' | 'skipped';
};

export type CopilotRecommendedAction = {
  type: string;
  label: string;
  reason?: string | null;
};

export type CopilotSuggestionInsights = {
  summary?: string;
  missingInformation?: string[];
  cautions?: string[];
  studioReleaseId?: string;
  studioVersion?: number;
  contextMessageId?: string;
  intent?: string | null;
  intentConfidence?: number | null;
  workflowId?: string | null;
  model?: string | null;
  knowledgeCoverage?: string | null;
  ragStrategy?: string | null;
  knowledgeSources?: CopilotKnowledgeSource[];
  toolsUsed?: CopilotToolTrace[];
  recommendedActions?: CopilotRecommendedAction[];
  validatorDecision?: string | null;
  latencyMs?: number | null;
};

export type CopilotSuggestion = {
  id: string;
  chatId: string;
  workspaceId: string;
  autopilotConfigId: string | null;
  systemAgentId: string | null;
  sourceMessageId: string | null;
  orchestratorRunId: string | null;
  /** Which orchestrator branch produced it — used to explain provenance in the UI. */
  stage: CopilotSuggestionStage;
  agentName: string;
  suggestion: string;
  messageBlocks: string[];
  insights: CopilotSuggestionInsights;
  status: CopilotSuggestionStatus;
  createdAt: string;
};

const STAGE_LABELS: Record<CopilotSuggestionStage, string> = {
  studio_copilot: 'Copiloto do Studio',
  deterministic_routing: 'Roteamento determinístico',
  flow_message: 'Etapa do fluxo',
  tool_memory: 'Dados já consultados',
  workflow_response: 'Fluxo de atendimento',
  post_tool_response: 'Consulta em sistemas',
  procedure_runtime: 'Procedimento da base',
  model_response: 'Resposta do agente',
  fallback: 'Contingência',
};

export function describeCopilotSuggestionStage(stage: string): string {
  return STAGE_LABELS[stage as CopilotSuggestionStage] || STAGE_LABELS.model_response;
}

const INTENT_LABELS: Record<string, string> = {
  billing_or_payment: 'Financeiro',
  support_request: 'Suporte',
  troubleshooting: 'Diagnóstico técnico',
  purchase_inquiry: 'Interesse comercial',
  scheduling_request: 'Agendamento',
  order_or_request_status: 'Status de pedido',
  document_request: 'Documentos',
  human_handoff: 'Pedido de humano',
  complaint: 'Reclamação',
  cancellation_request: 'Cancelamento',
  change_request: 'Alteração cadastral',
  return_or_refund: 'Devolução',
  availability_request: 'Disponibilidade',
  greeting: 'Saudação',
  gratitude: 'Agradecimento',
  small_talk: 'Conversa informal',
  deterministic_tool_routing: 'Consulta operacional',
  unknown: 'Intenção não identificada',
};

export function describeCopilotIntent(intent?: string | null): string | null {
  if (!intent) return null;
  return INTENT_LABELS[intent] || intent.replace(/_/g, ' ');
}
