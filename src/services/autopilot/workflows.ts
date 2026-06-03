import type {
  AutopilotSlotName,
  KnowledgeDocumentCategory,
  UniversalAutopilotIntent,
} from './intent-types';
import type { AgentToolName } from '@/services/agent-tools/types';

export type AutopilotWorkflowDefinition = {
  id: string;
  intent: UniversalAutopilotIntent;
  requiredSlots: AutopilotSlotName[];
  knowledgeCategories: KnowledgeDocumentCategory[];
  allowedTools: AgentToolName[];
  fallbackPolicy: 'answer_from_knowledge' | 'ask_clarifying_question' | 'handoff' | 'configured_fallback';
  handoffPolicy: 'never' | 'on_low_confidence' | 'on_tool_failure' | 'immediate';
  responsePolicy: 'llm_with_facts' | 'short_ack' | 'handoff_message';
};

const READ_ONLY_OPERATIONAL_TOOLS: AgentToolName[] = [
  'mcp_call_tool',
];

export const UNIVERSAL_AUTOPILOT_WORKFLOWS: Record<UniversalAutopilotIntent, AutopilotWorkflowDefinition> = {
  greeting: {
    id: 'universal.greeting',
    intent: 'greeting',
    requiredSlots: [],
    knowledgeCategories: ['persona', 'brand_voice', 'faq'],
    allowedTools: [],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'never',
    responsePolicy: 'short_ack',
  },
  human_handoff: {
    id: 'universal.human_handoff',
    intent: 'human_handoff',
    requiredSlots: [],
    knowledgeCategories: ['handoff_policy', 'escalation_policy'],
    allowedTools: ['transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'handoff',
    handoffPolicy: 'immediate',
    responsePolicy: 'handoff_message',
  },
  purchase_inquiry: {
    id: 'universal.purchase_inquiry',
    intent: 'purchase_inquiry',
    requiredSlots: [],
    knowledgeCategories: ['product_or_service_catalog', 'pricing', 'offers', 'sales', 'faq'],
    allowedTools: ['mcp_call_tool', 'transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  catalog_request: {
    id: 'universal.catalog_request',
    intent: 'catalog_request',
    requiredSlots: [],
    knowledgeCategories: ['product_or_service_catalog', 'pricing', 'offers', 'sales', 'faq'],
    allowedTools: ['mcp_call_tool'],
    fallbackPolicy: 'answer_from_knowledge',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  pricing_request: {
    id: 'universal.pricing_request',
    intent: 'pricing_request',
    requiredSlots: [],
    knowledgeCategories: ['pricing', 'offers', 'product_or_service_catalog', 'policy', 'faq'],
    allowedTools: ['mcp_call_tool'],
    fallbackPolicy: 'answer_from_knowledge',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  promotion_request: {
    id: 'universal.promotion_request',
    intent: 'promotion_request',
    requiredSlots: [],
    knowledgeCategories: ['offers', 'pricing', 'sales', 'policy', 'faq'],
    allowedTools: ['mcp_call_tool'],
    fallbackPolicy: 'answer_from_knowledge',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  availability_request: {
    id: 'universal.availability_request',
    intent: 'availability_request',
    requiredSlots: ['product_or_service_preference'],
    knowledgeCategories: ['product_or_service_catalog', 'sales', 'scheduling', 'faq'],
    allowedTools: ['mcp_call_tool'],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  billing_or_payment: {
    id: 'universal.billing_or_payment',
    intent: 'billing_or_payment',
    requiredSlots: ['customer_identifier'],
    knowledgeCategories: ['billing', 'policy', 'faq', 'tool_procedure'],
    allowedTools: READ_ONLY_OPERATIONAL_TOOLS,
    fallbackPolicy: 'handoff',
    handoffPolicy: 'on_tool_failure',
    responsePolicy: 'llm_with_facts',
  },
  scheduling_request: {
    id: 'universal.scheduling_request',
    intent: 'scheduling_request',
    requiredSlots: ['date', 'time'],
    knowledgeCategories: ['scheduling', 'policy', 'faq', 'tool_procedure'],
    allowedTools: ['mcp_call_tool', 'transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_tool_failure',
    responsePolicy: 'llm_with_facts',
  },
  order_or_request_status: {
    id: 'universal.order_or_request_status',
    intent: 'order_or_request_status',
    requiredSlots: ['order_or_request_id'],
    knowledgeCategories: ['order_or_request_status', 'support', 'faq', 'tool_procedure'],
    allowedTools: READ_ONLY_OPERATIONAL_TOOLS,
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_tool_failure',
    responsePolicy: 'llm_with_facts',
  },
  support_request: {
    id: 'universal.support_request',
    intent: 'support_request',
    requiredSlots: [],
    knowledgeCategories: ['support', 'troubleshooting', 'faq', 'tool_procedure'],
    allowedTools: READ_ONLY_OPERATIONAL_TOOLS,
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  troubleshooting: {
    id: 'universal.troubleshooting',
    intent: 'troubleshooting',
    requiredSlots: [],
    knowledgeCategories: ['troubleshooting', 'support', 'tool_procedure', 'faq'],
    allowedTools: READ_ONLY_OPERATIONAL_TOOLS,
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_tool_failure',
    responsePolicy: 'llm_with_facts',
  },
  change_request: {
    id: 'universal.change_request',
    intent: 'change_request',
    requiredSlots: ['product_or_service_id'],
    knowledgeCategories: ['policy', 'support', 'returns_or_cancellation', 'faq', 'tool_procedure'],
    allowedTools: ['mcp_call_tool', 'transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'handoff',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  return_or_refund: {
    id: 'universal.return_or_refund',
    intent: 'return_or_refund',
    requiredSlots: ['order_or_request_id'],
    knowledgeCategories: ['returns_or_cancellation', 'policy', 'billing', 'faq'],
    allowedTools: ['mcp_call_tool', 'transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'handoff',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  cancellation_request: {
    id: 'universal.cancellation_request',
    intent: 'cancellation_request',
    requiredSlots: [],
    knowledgeCategories: ['returns_or_cancellation', 'policy', 'legal', 'handoff_policy', 'faq'],
    allowedTools: ['transfer_chat', 'add_internal_note', 'mcp_call_tool'],
    fallbackPolicy: 'handoff',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
  document_request: {
    id: 'universal.document_request',
    intent: 'document_request',
    requiredSlots: [],
    knowledgeCategories: ['policy', 'legal', 'billing', 'faq', 'tool_procedure'],
    allowedTools: ['mcp_call_tool', 'transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_tool_failure',
    responsePolicy: 'llm_with_facts',
  },
  complaint: {
    id: 'universal.complaint',
    intent: 'complaint',
    requiredSlots: [],
    knowledgeCategories: ['escalation_policy', 'support', 'policy', 'handoff_policy'],
    allowedTools: ['transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'handoff',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'handoff_message',
  },
  thanks: {
    id: 'universal.thanks',
    intent: 'thanks',
    requiredSlots: [],
    knowledgeCategories: ['brand_voice'],
    allowedTools: [],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'never',
    responsePolicy: 'short_ack',
  },
  unknown: {
    id: 'universal.unknown',
    intent: 'unknown',
    requiredSlots: [],
    knowledgeCategories: ['faq', 'policy', 'support', 'uncategorized'],
    allowedTools: ['transfer_chat', 'add_internal_note'],
    fallbackPolicy: 'ask_clarifying_question',
    handoffPolicy: 'on_low_confidence',
    responsePolicy: 'llm_with_facts',
  },
};

export function getAutopilotWorkflow(intent: UniversalAutopilotIntent): AutopilotWorkflowDefinition {
  return UNIVERSAL_AUTOPILOT_WORKFLOWS[intent] ?? UNIVERSAL_AUTOPILOT_WORKFLOWS.unknown;
}

export function getKnowledgeCategoriesForIntent(intent: UniversalAutopilotIntent): KnowledgeDocumentCategory[] {
  return getAutopilotWorkflow(intent).knowledgeCategories;
}
