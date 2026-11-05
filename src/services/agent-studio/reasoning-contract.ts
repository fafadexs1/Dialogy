import { z } from 'zod';

const RequestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  procedureId: z.string().nullable(),
  resumeFrom: z.string().min(1).max(200).nullable().optional(),
  objective: z.string().min(1).max(2000),
  status: z.enum(['active', 'paused', 'resolved', 'cancelled']),
}).strict();

/** Operational decisions only. Internal chain of thought is neither requested nor persisted. */
export const StudioReasoningDecisionSchema = z.object({
  requests: z.array(RequestSchema).max(20).refine((requests) => new Set(requests.map((request) => request.id)).size === requests.length,
    'Envie uma única atualização por pedido em cada decisão.'),
  choices: z.array(z.object({
    requestId: z.string(), key: z.string().min(1).max(200).refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key)), label: z.string().min(1).max(500),
    value: z.string().max(8000).nullable(), status: z.enum(['active', 'unavailable', 'cancelled']),
    sourceMessageId: z.string(), quote: z.string().min(1).max(4000),
  }).strict()).max(40).refine((choices) => new Set(choices.map((choice) => JSON.stringify([choice.requestId, choice.key]))).size === choices.length,
    'Envie uma única atualização por escolha do pedido em cada decisão.'),
  action: z.object({
    kind: z.enum(['respond', 'tool', 'knowledge', 'recall', 'recall_history', 'consult', 'handoff', 'branch']),
    requestId: z.string().nullable(), capabilityId: z.string().nullable(),
    query: z.string().max(4000).nullable(), response: z.string().max(12000).nullable(),
    consent: z.enum(['none', 'approve', 'decline']),
    consentQuote: z.string().max(4000).nullable(),
    reason: z.string().max(1000),
  }).strict(),
}).strict();
export type StudioReasoningDecision = z.infer<typeof StudioReasoningDecisionSchema>;

export const StudioReasoningStateSchema = z.object({
  version: z.literal(2),
  recallCursor: z.string().optional(),
  historyCursor: z.string().optional(),
  usageTotals: z.object({
    lastMessageId: z.string(), recordedTurns: z.number().int().nonnegative(),
    turnsWithoutUsage: z.number().int().nonnegative(), inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative(),
  }).optional(),
  lastTurnMetrics: z.object({
    messageId: z.string(), durationMs: z.number().nonnegative(), modelDecisions: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(), activeRequests: z.number().int().nonnegative(),
    pausedRequests: z.number().int().nonnegative(), resolvedRequests: z.number().int().nonnegative(),
    uncertainOperations: z.number().int().nonnegative(), transferred: z.boolean(), budgetReached: z.boolean(),
    usage: z.array(z.object({ model: z.string(), stage: z.string(), calls: z.number().int().nonnegative(),
      inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative() })).optional(),
  }).optional(),
  requests: z.array(RequestSchema.extend({
    memoryRequestId: z.string().min(1).max(200).optional(),
    values: z.record(z.unknown()),
    integrationValues: z.record(z.unknown()).default({}),
    choiceLabels: z.record(z.unknown()).default({}),
    unavailable: z.array(z.string()),
    branchSelections: z.record(z.object({ branchId: z.string(), signature: z.string() })).optional(),
  })).max(20),
  operations: z.array(z.object({
    id: z.string(), requestId: z.string(), capabilityId: z.string(), signature: z.string(),
    memoryRequestId: z.string().min(1).max(200).optional(),
    status: z.enum(['succeeded', 'failed', 'unknown']),
    readOnly: z.boolean().optional(),
    attemptMessageId: z.string().optional(),
    integrationIdentity: z.string().optional(),
    integrationReset: z.string().nullable().optional(),
    failureCategory: z.enum(['temporary_read_failure', 'business_negative', 'access_blocked', 'permanent_read_failure', 'unknown_effect']).optional(),
    title: z.string().max(500).optional(),
    values: z.record(z.unknown()), at: z.string(),
    presentedProduct: z.object({ productId: z.union([z.string(), z.number()]), caption: z.string(), url: z.string() }).optional(),
  })).max(100),
  pendingAction: z.object({
    requestId: z.string(), capabilityId: z.string(), signature: z.string(),
    proposedMessageId: z.string(),
    proposalText: z.string().max(12000).optional(),
  }).nullable(),
});
export type StudioReasoningState = z.infer<typeof StudioReasoningStateSchema>;

const string = { type: 'string' };
const nullableString = { type: ['string', 'null'] };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const studioReasoningDecisionJsonSchema = object({
  requests: { type: 'array', items: object({ id: string, procedureId: nullableString, resumeFrom: nullableString, objective: string,
    status: { type: 'string', enum: ['active', 'paused', 'resolved', 'cancelled'] } }) },
  choices: { type: 'array', items: object({ requestId: string, key: string, label: string, value: nullableString,
    status: { type: 'string', enum: ['active', 'unavailable', 'cancelled'] }, sourceMessageId: string, quote: string }) },
  action: object({ kind: { type: 'string', enum: ['respond', 'tool', 'knowledge', 'recall', 'recall_history', 'handoff', 'branch'] },
    requestId: nullableString, capabilityId: nullableString, query: nullableString, response: nullableString,
    consent: { type: 'string', enum: ['none', 'approve', 'decline'] }, consentQuote: nullableString, reason: string }),
});
