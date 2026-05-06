export type UniversalAutopilotIntent =
  | 'greeting'
  | 'human_handoff'
  | 'purchase_inquiry'
  | 'catalog_request'
  | 'pricing_request'
  | 'promotion_request'
  | 'availability_request'
  | 'billing_or_payment'
  | 'scheduling_request'
  | 'order_or_request_status'
  | 'support_request'
  | 'troubleshooting'
  | 'change_request'
  | 'return_or_refund'
  | 'cancellation_request'
  | 'document_request'
  | 'complaint'
  | 'thanks'
  | 'unknown';

export type AutopilotSlotName =
  | 'name'
  | 'customer_identifier'
  | 'date'
  | 'time'
  | 'phone'
  | 'email'
  | 'address'
  | 'order_or_request_id'
  | 'invoice_or_payment_id'
  | 'product_or_service_id'
  | 'product_or_service_preference'
  | 'quantity'
  | 'location';

export type AutopilotExtractedSlots = Partial<Record<AutopilotSlotName, string>>;

export type KnowledgeCoverage = 'high' | 'medium' | 'low' | 'none';

export type KnowledgeDocumentCategory =
  | 'persona'
  | 'brand_voice'
  | 'product_or_service_catalog'
  | 'pricing'
  | 'offers'
  | 'sales'
  | 'support'
  | 'billing'
  | 'scheduling'
  | 'order_or_request_status'
  | 'onboarding'
  | 'troubleshooting'
  | 'returns_or_cancellation'
  | 'policy'
  | 'legal'
  | 'faq'
  | 'tool_procedure'
  | 'escalation_policy'
  | 'handoff_policy'
  | 'compliance'
  | 'internal_only'
  | 'uncategorized'
  | string;

export type AutopilotIntentResolution = {
  intent: UniversalAutopilotIntent;
  subIntent?: string | null;
  confidence: number;
  reason: string;
  requiredSlots: AutopilotSlotName[];
  extractedSlots: AutopilotExtractedSlots;
  workflowId: string;
  shouldUseLlm: boolean;
  shouldRetrieveKnowledge: boolean;
  shouldUseTool: boolean;
  shouldTransfer: boolean;
  knowledgeCategories: KnowledgeDocumentCategory[];
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  officialResponse?: string;
};
