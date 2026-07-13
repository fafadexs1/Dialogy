import { createHash } from 'crypto';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import {
  canonicalWorkflowFieldName,
  hasKnownWorkflowField,
} from '@/services/workflow-runtime/goal-completion';
import {
  isAgentTerminalCompletionResponse,
  isConversationCloseRequest,
} from './close-intent';
import { hashValue, isRecord } from '@/services/workflow-runtime/utils';
import { isValidCustomerIdentifier } from './slots';

export const COLLECTION_COMPLETION_STATE_KEY = 'collectionCompletionV1' as const;
export const COLLECTION_COMPLETION_VERSION = 2 as const;
const COLLECTION_COMPLETION_CLAIM_TTL_MS = Math.max(
  30_000,
  Math.min(30 * 60_000, Number(process.env.AUTOPILOT_COLLECTION_CLOSE_CLAIM_TTL_MS || 300_000) || 300_000),
);

export type CollectionCompletionCheckpoint = {
  version: typeof COLLECTION_COMPLETION_VERSION;
  status: 'awaiting_fields' | 'closing';
  chatId: string;
  autopilotConfigId: string;
  workflowId: string;
  workflowVersion: string;
  agentNodeId: string;
  askNodeId: string;
  needsInputExecutionId: string;
  needsInputSourceMessageId: string;
  pendingFields: string[];
  confirmedFields: string[];
  pendingFieldsFingerprint: string;
  checkpointFingerprint: string;
  askedAt: string;
  closingClaimedAt?: string;
};

export type PersistedCollectionFieldReceipt = {
  field: string;
  value: string;
  storage: 'slot_memory' | 'contact' | 'crm_custom_field';
  storageKey: string;
  sourceMessageId: string;
  persistedAt: string;
  valueHash: string;
};

export type CollectionResponseRoute = {
  kind: 'needs_input' | 'completed';
  workflowId: string;
  workflowVersion: string;
  executionId: string;
  agentNodeId: string;
  respondNodeId: string;
  response: string;
  missingFields: string[];
  hasFailedToolCalls: boolean;
};

export function directAgentRouteHasFailedToolCalls(input: NodeRuntimeInput): boolean {
  const previousNodeId = input.execution.previousNodeId;
  if (!previousNodeId) return false;
  const previousNode = input.workflow.nodes.find((node) => node.id === previousNodeId);
  const previousResult = input.execution.nodeResults[previousNodeId];
  if (previousNode?.type !== 'ai.agent' || !previousResult) return false;
  return (previousResult.toolCalls || []).some((call) => (
    call.status === 'error' || call.status === 'rejected'
  ));
}

function uniqueFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(String)
      .map((field) => field.replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(Boolean),
  )].slice(0, 30);
}

function safeIso(value: unknown): string | null {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function pendingCollectionFieldsFingerprint(fields: string[]): string {
  return hashValue([...new Set(fields.map(canonicalWorkflowFieldName).filter(Boolean))].sort());
}

function checkpointFingerprint(input: Omit<CollectionCompletionCheckpoint, 'checkpointFingerprint' | 'status' | 'closingClaimedAt'>) {
  return hashValue({ ...input, status: 'awaiting_fields' });
}

export function parseCollectionCompletionCheckpoint(value: unknown): CollectionCompletionCheckpoint | null {
  if (!isRecord(value) || value.version !== COLLECTION_COMPLETION_VERSION) return null;
  const pendingFields = uniqueFields(value.pendingFields);
  const confirmedFields = uniqueFields(value.confirmedFields);
  const askedAt = safeIso(value.askedAt);
  const closingClaimedAt = safeIso(value.closingClaimedAt);
  const rawStatus = value.status === 'closing' ? 'closing' : value.status === 'awaiting_fields' ? 'awaiting_fields' : null;
  const status = rawStatus === 'closing' && (
    !closingClaimedAt
    || Date.now() - new Date(closingClaimedAt).getTime() >= COLLECTION_COMPLETION_CLAIM_TTL_MS
  ) ? 'awaiting_fields' : rawStatus;
  const strings = {
    chatId: String(value.chatId || '').trim(),
    autopilotConfigId: String(value.autopilotConfigId || '').trim(),
    workflowId: String(value.workflowId || '').trim(),
    workflowVersion: String(value.workflowVersion || '').trim(),
    agentNodeId: String(value.agentNodeId || '').trim(),
    askNodeId: String(value.askNodeId || '').trim(),
    needsInputExecutionId: String(value.needsInputExecutionId || '').trim(),
    needsInputSourceMessageId: String(value.needsInputSourceMessageId || '').trim(),
    pendingFieldsFingerprint: String(value.pendingFieldsFingerprint || '').trim(),
    checkpointFingerprint: String(value.checkpointFingerprint || '').trim(),
  };
  if (
    !status
    || !askedAt
    || pendingFields.length === 0
    || confirmedFields.some((confirmed) => (
      !pendingFields.some((pending) => canonicalWorkflowFieldName(pending) === canonicalWorkflowFieldName(confirmed))
    ))
    || Object.values(strings).some((item) => !item)
    || strings.pendingFieldsFingerprint !== pendingCollectionFieldsFingerprint(pendingFields)
  ) return null;

  const withoutFingerprint = {
    version: COLLECTION_COMPLETION_VERSION,
    chatId: strings.chatId,
    autopilotConfigId: strings.autopilotConfigId,
    workflowId: strings.workflowId,
    workflowVersion: strings.workflowVersion,
    agentNodeId: strings.agentNodeId,
    askNodeId: strings.askNodeId,
    needsInputExecutionId: strings.needsInputExecutionId,
    needsInputSourceMessageId: strings.needsInputSourceMessageId,
    pendingFields,
    confirmedFields,
    pendingFieldsFingerprint: strings.pendingFieldsFingerprint,
    askedAt,
  } satisfies Omit<CollectionCompletionCheckpoint, 'checkpointFingerprint' | 'status' | 'closingClaimedAt'>;
  if (strings.checkpointFingerprint !== checkpointFingerprint(withoutFingerprint)) return null;

  return {
    ...withoutFingerprint,
    status,
    checkpointFingerprint: strings.checkpointFingerprint,
    ...(closingClaimedAt ? { closingClaimedAt } : {}),
  };
}

export function inspectCollectionResponseRoute(
  input: NodeRuntimeInput,
  renderedResponse?: string,
): CollectionResponseRoute | null {
  if (input.node.type !== 'output.respond' || input.execution.currentNodeId !== input.node.id) return null;
  const connections = input.workflow.connections.filter((connection) => (
    connection.targetNodeId === input.node.id
    && connection.connectionType === 'main'
  ));

  for (const connection of connections) {
    const sourceNode = input.workflow.nodes.find((node) => node.id === connection.sourceNodeId);
    const sourceResult = input.execution.nodeResults[connection.sourceNodeId];
    if (
      sourceNode?.type !== 'ai.agent'
      || !sourceResult
      || input.execution.previousNodeId !== sourceNode.id
      || sourceResult.selectedOutput !== connection.sourcePortId
      || !isRecord(sourceResult.output)
    ) continue;

    const failedToolCalls = directAgentRouteHasFailedToolCalls(input);
    if (
      connection.sourcePortId === 'needs_input'
      && sourceResult.output.type === 'needs_input'
    ) {
      const missingFields = uniqueFields(sourceResult.output.missingFields);
      const sourceQuestion = String(sourceResult.output.question || input.input.question || '').trim();
      const question = String(renderedResponse || sourceQuestion).trim();
      if (renderedResponse && !responsesArePassThroughCompatible(sourceQuestion, question)) return null;
      if (!question || missingFields.length === 0) return null;
      return {
        kind: 'needs_input',
        workflowId: input.workflow.id,
        workflowVersion: input.workflow.version,
        executionId: input.execution.executionId,
        agentNodeId: sourceNode.id,
        respondNodeId: input.node.id,
        response: question,
        missingFields,
        hasFailedToolCalls: failedToolCalls,
      };
    }

    if (
      connection.sourcePortId === 'completed'
      && sourceResult.selectedOutput === 'completed'
      && sourceResult.output.type === 'final'
      && sourceResult.output.completionStatus === 'completed'
    ) {
      const sourceResponse = String(sourceResult.output.response || input.input.response || '').trim();
      const response = String(renderedResponse || sourceResponse).trim();
      if (renderedResponse && !responsesArePassThroughCompatible(sourceResponse, response)) return null;
      if (!response) return null;
      return {
        kind: 'completed',
        workflowId: input.workflow.id,
        workflowVersion: input.workflow.version,
        executionId: input.execution.executionId,
        agentNodeId: sourceNode.id,
        respondNodeId: input.node.id,
        response,
        missingFields: [],
        hasFailedToolCalls: failedToolCalls,
      };
    }
  }
  return null;
}

function responsesArePassThroughCompatible(source: string, rendered: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedSource = normalize(source);
  const normalizedRendered = normalize(rendered);
  return Boolean(
    normalizedSource
    && normalizedRendered
    && normalizedSource === normalizedRendered
  );
}

export function buildCollectionCompletionCheckpoint(input: {
  chatId: string;
  autopilotConfigId: string;
  sourceMessageId: string;
  route: CollectionResponseRoute;
  askedAt?: string;
  previousCheckpoint?: CollectionCompletionCheckpoint | null;
  knownFields?: Record<string, unknown>;
  receipts?: PersistedCollectionFieldReceipt[];
}): CollectionCompletionCheckpoint | null {
  if (
    input.route.kind !== 'needs_input'
    || input.route.missingFields.length === 0
    || input.route.hasFailedToolCalls
  ) return null;
  const previous = input.previousCheckpoint?.status === 'awaiting_fields'
    && input.previousCheckpoint.chatId === input.chatId
    && input.previousCheckpoint.autopilotConfigId === input.autopilotConfigId
    && input.previousCheckpoint.workflowId === input.route.workflowId
    && input.previousCheckpoint.workflowVersion === input.route.workflowVersion
    && input.previousCheckpoint.agentNodeId === input.route.agentNodeId
    ? input.previousCheckpoint
    : null;
  const pendingFields = uniqueFields([
    ...(previous?.pendingFields || []),
    ...input.route.missingFields,
  ]);
  const askedAt = safeIso(input.askedAt || new Date().toISOString());
  if (!askedAt || pendingFields.length === 0) return null;
  const currentlyRequested = new Set(input.route.missingFields.map(canonicalWorkflowFieldName));
  const newlyConfirmed = previous?.pendingFields.filter((field) => (
    !currentlyRequested.has(canonicalWorkflowFieldName(field))
    && hasKnownWorkflowField(field, input.knownFields || {})
    && (input.receipts || []).some((receipt) => receiptSatisfiesField(
      receipt,
      field,
      input.sourceMessageId,
      previous.askedAt,
    ))
  )) || [];
  const confirmedFields = uniqueFields([
    ...(previous?.confirmedFields || []),
    ...newlyConfirmed,
  ]).filter((field) => !currentlyRequested.has(canonicalWorkflowFieldName(field)));
  const base = {
    version: COLLECTION_COMPLETION_VERSION,
    chatId: input.chatId,
    autopilotConfigId: input.autopilotConfigId,
    workflowId: input.route.workflowId,
    workflowVersion: input.route.workflowVersion,
    agentNodeId: input.route.agentNodeId,
    askNodeId: input.route.respondNodeId,
    needsInputExecutionId: input.route.executionId,
    needsInputSourceMessageId: input.sourceMessageId,
    pendingFields,
    confirmedFields,
    pendingFieldsFingerprint: pendingCollectionFieldsFingerprint(pendingFields),
    askedAt,
  } satisfies Omit<CollectionCompletionCheckpoint, 'checkpointFingerprint' | 'status' | 'closingClaimedAt'>;
  return {
    ...base,
    status: 'awaiting_fields',
    checkpointFingerprint: checkpointFingerprint(base),
  };
}

function normalizeReplyValue(value: string): string {
  return value
    .replace(/^[\s'"“”]+|[\s'"“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function isUnsafeCollectionReply(value: string, field: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || /[?ï¼Ÿ]/.test(value)) return true;
  const booleanLikeField = /(?:consent|aceite|confirm|autoriz|permiss|opt.?in|termos|deseja|possui|tem_)/.test(
    canonicalWorkflowFieldName(field),
  );
  if (/^(?:nao|sim)$/.test(normalized)) return !booleanLikeField;
  if (/^(?:ok|okay|certo|obrigad[ao]|valeu|oi|ola|bom dia|boa tarde|boa noite)$/.test(normalized)) return true;
  if (/\b(?:quero|preciso|gostaria|pode|consegue)\b.{0,50}\b(?:falar|conversar|transferir|chamar)\b.{0,40}\b(?:humano|atendente|pessoa|equipe|suporte)\b/.test(normalized)) return true;
  if (/\b(?:cancelar|desistir|parar|encerrar|finalizar)\b/.test(normalized)) return true;

  const canonical = canonicalWorkflowFieldName(field);
  if (canonical === 'name') {
    return (
      value.length < 2
      || value.length > 120
      || /\d|@|https?:\/\//i.test(value)
      || normalized.split(' ').length > 8
      || /\b(?:quero|preciso|gostaria|ajuda|atendimento|problema|duvida|humano|atendente)\b/.test(normalized)
    );
  }
  if (canonical === 'email') return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  if (canonical === 'postal_code') return value.replace(/\D/g, '').length !== 8;
  if (canonical === 'phone') return ![10, 11, 12, 13].includes(value.replace(/\D/g, '').length);
  if (canonical === 'customer_identifier') return !isValidCustomerIdentifier(value);
  return false;
}

/**
 * Extracts arbitrary, explicitly labelled CRM fields requested in the prior
 * turn. Single-field short replies are accepted; multi-field replies require
 * labels so values cannot be silently assigned to the wrong field.
 */
export function extractPendingCollectionReplyFields(input: {
  customerMessage: string;
  pendingFields: string[];
  alreadyKnownFields: Record<string, unknown>;
}): Record<string, string> {
  const pendingFields = uniqueFields(input.pendingFields)
    .filter((field) => !hasKnownWorkflowField(field, input.alreadyKnownFields));
  if (pendingFields.length === 0) return {};
  const message = input.customerMessage.trim();
  if (!message || message.length > 2_000 || isConversationCloseRequest(message)) return {};

  const byCanonical = new Map(pendingFields.map((field) => [canonicalWorkflowFieldName(field), field]));
  const extracted: Record<string, string> = {};
  const labelled = /(?:^|[\n;,|])\s*([\p{L}\p{N}_.() /-]{1,100}?)\s*(?::|=|\sé\s)\s*([^\n;,|]{1,500})/giu;
  for (const match of message.matchAll(labelled)) {
    const requestedField = byCanonical.get(canonicalWorkflowFieldName(match[1] || ''));
    const value = normalizeReplyValue(match[2] || '');
    if (requestedField && value && !isUnsafeCollectionReply(value, requestedField)) {
      extracted[requestedField] = value;
    }
  }

  const stillMissing = pendingFields.filter((field) => !hasKnownWorkflowField(field, extracted));
  if (
    stillMissing.length === 1
    && pendingFields.length === 1
    && Object.keys(extracted).length === 0
    && !/[?？]/.test(message)
  ) {
    const value = normalizeReplyValue(message.replace(/^[^:=]{1,100}(?::|=)\s*/, ''));
    if (value && !isUnsafeCollectionReply(value, stillMissing[0])) {
      extracted[stillMissing[0]] = value;
    }
  }
  return extracted;
}

export function createPersistedCollectionFieldReceipt(input: {
  field: string;
  value: string;
  storage: PersistedCollectionFieldReceipt['storage'];
  storageKey?: string;
  sourceMessageId: string;
  persistedAt?: string;
}): PersistedCollectionFieldReceipt {
  const value = input.value.replace(/\s+/g, ' ').trim().slice(0, 500);
  const persistedAt = safeIso(input.persistedAt || new Date().toISOString()) || new Date().toISOString();
  return {
    field: input.field,
    value,
    storage: input.storage,
    storageKey: String(input.storageKey || input.field).trim().slice(0, 160),
    sourceMessageId: input.sourceMessageId,
    persistedAt,
    valueHash: createHash('sha256').update(value).digest('hex'),
  };
}

function receiptSatisfiesField(
  receipt: PersistedCollectionFieldReceipt,
  field: string,
  sourceMessageId: string,
  askedAt: string,
): boolean {
  const persistedAt = new Date(receipt.persistedAt).getTime();
  return (
    receipt.sourceMessageId === sourceMessageId
    && Number.isFinite(persistedAt)
    && persistedAt >= new Date(askedAt).getTime()
    && hasKnownWorkflowField(field, { [receipt.field]: receipt.value })
  );
}

export function evaluateCompletedCollectionClose(input: {
  checkpoint: CollectionCompletionCheckpoint | null;
  route: CollectionResponseRoute;
  chatId: string;
  autopilotConfigId: string;
  sourceMessageId: string;
  knownFields: Record<string, unknown>;
  receipts: PersistedCollectionFieldReceipt[];
  invalidFieldNames: string[];
}): {
  allowed: boolean;
  reason: string;
  persistenceReceiptFingerprint?: string;
} {
  const checkpoint = input.checkpoint;
  if (!checkpoint || checkpoint.status !== 'awaiting_fields') return { allowed: false, reason: 'checkpoint_missing' };
  if (input.route.kind !== 'completed') return { allowed: false, reason: 'route_not_completed' };
  if (
    checkpoint.chatId !== input.chatId
    || checkpoint.autopilotConfigId !== input.autopilotConfigId
    || checkpoint.workflowId !== input.route.workflowId
    || checkpoint.workflowVersion !== input.route.workflowVersion
    || checkpoint.agentNodeId !== input.route.agentNodeId
    || checkpoint.needsInputExecutionId === input.route.executionId
  ) return { allowed: false, reason: 'checkpoint_binding_mismatch' };
  if (input.route.hasFailedToolCalls) return { allowed: false, reason: 'agent_tool_failure' };
  if (!isAgentTerminalCompletionResponse(input.route.response)) return { allowed: false, reason: 'response_not_terminal' };
  if (input.invalidFieldNames.length > 0) return { allowed: false, reason: 'invalid_collected_field' };

  const missingKnown = checkpoint.pendingFields.filter((field) => !hasKnownWorkflowField(field, input.knownFields));
  if (missingKnown.length > 0) return { allowed: false, reason: 'pending_fields_not_known' };
  const usedReceipts = checkpoint.pendingFields.map((field) => (
    checkpoint.confirmedFields.some((confirmed) => (
      canonicalWorkflowFieldName(confirmed) === canonicalWorkflowFieldName(field)
    ))
      ? null
      : input.receipts.find((receipt) => receiptSatisfiesField(receipt, field, input.sourceMessageId, checkpoint.askedAt))
  ));
  if (usedReceipts.some((receipt, index) => (
    !receipt
    && !checkpoint.confirmedFields.some((confirmed) => (
      canonicalWorkflowFieldName(confirmed) === canonicalWorkflowFieldName(checkpoint.pendingFields[index] || '')
    ))
  ))) return { allowed: false, reason: 'persistence_receipt_missing' };

  const persistenceReceiptFingerprint = hashValue(usedReceipts.map((receipt, index) => (
    receipt ? {
      field: canonicalWorkflowFieldName(receipt.field),
      storage: receipt.storage,
      storageKey: receipt.storageKey,
      sourceMessageId: receipt.sourceMessageId,
      persistedAt: receipt.persistedAt,
      valueHash: receipt.valueHash,
    } : {
      field: canonicalWorkflowFieldName(checkpoint.pendingFields[index] || ''),
      storage: 'prior_checkpoint',
      checkpointFingerprint: checkpoint.checkpointFingerprint,
    }
  )));
  return { allowed: true, reason: 'collection_completed', persistenceReceiptFingerprint };
}
