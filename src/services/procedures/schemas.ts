import { z } from 'zod';

export const PROCEDURE_STEP_TYPES = [
  'gather_data',
  'retrieve_knowledge',
  'validate',
  'tool_call',
  'decide',
  'respond',
  'handoff',
] as const;

export const PROCEDURE_INTENTS = [
  'greeting',
  'human_handoff',
  'purchase_inquiry',
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'availability_request',
  'billing_or_payment',
  'scheduling_request',
  'order_or_request_status',
  'support_request',
  'troubleshooting',
  'change_request',
  'return_or_refund',
  'cancellation_request',
  'document_request',
  'complaint',
  'thanks',
  'unknown',
] as const;

const compactText = z.string().trim().min(1).max(2_000);
const optionalCompactText = z.string().trim().max(8_000).optional();

export const ProcedureSlotDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum(['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean']).default('text'),
  required: z.boolean().default(true),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  placeholder: z.string().trim().max(160).optional(),
}).strict();

export const ProcedureBranchSchema = z.object({
  condition: z.string().trim().min(1).max(1_000),
  nextStepId: z.string().trim().min(1).max(160),
}).strict();

export const ProcedureStepSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/),
  order: z.number().int().min(1).max(200),
  type: z.enum(PROCEDURE_STEP_TYPES),
  label: z.string().trim().min(1).max(240),
  visualNodeId: z.string().trim().max(160).optional(),
  visualNodeKind: z.string().trim().max(120).optional(),
  semanticIntent: z.string().trim().max(160).optional(),
  forbiddenCustomerIntents: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
  requiresExplicitCustomerRequest: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
  sideEffect: z.enum(['none', 'low', 'medium', 'high']).optional(),
  requiredSlots: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  slotDefinitions: z.array(ProcedureSlotDefinitionSchema).max(40).optional(),
  promptTemplate: optionalCompactText,
  knowledgeQueryTemplate: optionalCompactText,
  knowledgeCollectionIds: z.array(z.string().trim().min(1).max(160)).max(64).optional(),
  knowledgeDocumentIds: z.array(z.string().trim().min(1).max(160)).max(256).optional(),
  requiredKnowledgeCoverage: z.enum(['high', 'medium', 'low', 'none']).optional(),
  onLowKnowledge: z.enum(['continue', 'pause', 'handoff']).optional(),
  toolName: z.string().trim().max(300).optional(),
  toolPayloadTemplate: z.record(z.string().max(4_000)).optional(),
  confirmationPrompt: z.string().trim().max(2_000).optional(),
  successStepId: z.string().trim().max(160).nullable().optional(),
  errorStepId: z.string().trim().max(160).nullable().optional(),
  condition: optionalCompactText,
  onFail: z.enum(['retry', 'skip', 'abort', 'handoff']).optional(),
  decisionPrompt: optionalCompactText,
  branches: z.array(ProcedureBranchSchema).max(20).optional(),
  responseTemplate: z.string().trim().max(8_000).optional(),
  useLlm: z.boolean().optional(),
  requireGrounding: z.boolean().optional(),
  returnToMainPrompt: z.boolean().optional(),
  handoffReason: z.string().trim().max(2_000).optional(),
  nextStepId: z.string().trim().max(160).nullable().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
}).strict();

export const ProcedureGraphSchema = z.object({
  id: z.string().trim().min(1).max(160),
  documentId: z.string().trim().min(1).max(240),
  documentName: z.string().trim().min(1).max(200),
  version: z.number().int().min(1).max(1_000_000),
  compiledAt: z.string().datetime(),
  triggerIntents: z.array(z.enum(PROCEDURE_INTENTS)).min(1).max(20),
  triggerKeywords: z.array(z.string().trim().min(1).max(300)).min(1).max(80),
  steps: z.array(ProcedureStepSchema).min(1).max(120),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export const ProcedureTriggerSchema = z.object({
  intents: z.array(z.enum(PROCEDURE_INTENTS)).min(1).max(12),
  phrases: z.array(z.string().trim().min(3).max(300)).min(1).max(40),
  keywords: z.array(z.string().trim().min(2).max(120)).max(60).default([]),
  exclusions: z.array(z.string().trim().min(3).max(300)).max(30).default([]),
}).strict();

export const ProcedureStudioDocumentSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^proc_[a-zA-Z0-9_-]+$/),
  configId: z.string().uuid(),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2_000).default(''),
  goal: z.string().trim().min(3).max(1_000),
  priority: z.number().int().min(0).max(1_000).default(100),
  trigger: ProcedureTriggerSchema,
  steps: z.array(ProcedureStepSchema).min(1).max(120),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export const ProcedureToolOptionSchema = z.object({
  name: z.string().trim().min(1).max(300),
  displayName: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2_000).default(''),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  sideEffect: z.enum(['none', 'low', 'medium', 'high']).default('none'),
  requiresHumanApproval: z.boolean().default(false),
  enabled: z.boolean().default(false),
  requiredSlots: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  inputSchema: z.record(z.unknown()).nullable().optional(),
}).strict();

export type ProcedureStudioDocument = z.infer<typeof ProcedureStudioDocumentSchema>;
export type ProcedureStudioStep = z.infer<typeof ProcedureStepSchema>;
export type ProcedureToolOption = z.infer<typeof ProcedureToolOptionSchema>;
export type ProcedureGraphInput = z.infer<typeof ProcedureGraphSchema>;

export const ProcedureStudioSaveInputSchema = z.object({
  configId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).nullable().optional(),
  procedure: ProcedureStudioDocumentSchema,
}).strict();

export const ProcedureStudioPublishInputSchema = z.object({
  configId: z.string().uuid(),
  procedureId: z.string().trim().regex(/^proc_[a-zA-Z0-9_-]+$/),
  expectedRevision: z.number().int().min(1),
}).strict();

export const ProcedureStudioGenerateInputSchema = z.object({
  configId: z.string().uuid(),
  description: compactText.max(12_000),
  currentProcedure: ProcedureStudioDocumentSchema.nullable().optional(),
}).strict();
