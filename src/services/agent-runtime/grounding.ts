import type { KnowledgeBaseDocument } from '@/lib/types';
import { inferKnowledgeContextRole } from '@/services/rag/knowledge-document';
import type { JsonObject } from './types';

export type AgentEvidenceKind = 'knowledge_document' | 'operational_tool' | 'case_memory' | 'structured_memory';

export type AgentEvidence = {
  kind: AgentEvidenceKind;
  sourceId: string;
  title?: string | null;
  reference: string;
  status?: 'valid' | 'invalid' | 'unknown';
  retrievalSources?: string[];
  contextRole?: string | null;
  toolName?: string | null;
  toolStatus?: string | null;
  payload?: JsonObject;
};

function documentStatus(document: Pick<KnowledgeBaseDocument, 'status' | 'validFrom' | 'validUntil'>): 'valid' | 'invalid' | 'unknown' {
  const status = String(document.status || 'active').toLowerCase();
  if (['draft', 'archived', 'expired', 'inactive'].includes(status)) return 'invalid';
  const now = Date.now();
  if (document.validFrom && Date.parse(document.validFrom) > now) return 'invalid';
  if (document.validUntil && Date.parse(document.validUntil) < now) return 'invalid';
  return 'valid';
}

export function buildKnowledgeEvidence(document: KnowledgeBaseDocument): AgentEvidence {
  const documentId = String(document.id || document.name || 'document');
  const chunkSuffix = document.chunkIndex == null ? '' : `#chunk-${document.chunkIndex}`;
  return {
    kind: 'knowledge_document',
    sourceId: documentId,
    title: document.name || null,
    reference: `knowledge:${documentId}${chunkSuffix}`,
    status: documentStatus(document),
    retrievalSources: document.retrievalSources || (document.source ? [document.source] : []),
    contextRole: inferKnowledgeContextRole(document),
    payload: {
      category: document.category || null,
      chunkIndex: document.chunkIndex ?? null,
      chunkCount: document.chunkCount ?? null,
      validUntil: document.validUntil || null,
    },
  };
}

export function buildOperationalToolEvidence(input: {
  toolName: string;
  status: string;
  executionId?: string | null;
  output?: JsonObject | null;
  error?: string | null;
}): AgentEvidence {
  const executionId = input.executionId || `${input.toolName}:${Date.now()}`;
  return {
    kind: 'operational_tool',
    sourceId: executionId,
    reference: `tool:${input.toolName}:${executionId}`,
    title: input.toolName,
    status: input.status === 'success' ? 'valid' : 'invalid',
    toolName: input.toolName,
    toolStatus: input.status,
    payload: {
      output: input.output || null,
      error: input.error || null,
    },
  };
}

export function isOperationalFactType(value: string | null | undefined): boolean {
  return /(stock|inventory|saldo|balance|pedido|order|contrato|contract|pagamento|payment|invoice|fatura|signal|sinal|status|shipment|entrega|delivery)/i.test(String(value || ''));
}

export function validateAgentAnswerGrounding(input: {
  claimType: 'documentary' | 'operational' | 'mixed';
  evidence: AgentEvidence[];
  requiredToolNames?: string[];
}): { allowed: boolean; reason: string; usableEvidence: AgentEvidence[] } {
  const usableEvidence = (input.evidence || []).filter((item) => item.status === 'valid');
  const hasDocument = usableEvidence.some((item) => item.kind === 'knowledge_document');
  const successfulTools = usableEvidence.filter((item) => item.kind === 'operational_tool' && item.toolStatus === 'success');
  const hasRequiredTools = (input.requiredToolNames || []).every((toolName) => (
    successfulTools.some((item) => item.toolName === toolName)
  ));

  if (input.claimType === 'documentary' && !hasDocument) {
    return { allowed: false, reason: 'documentary_claim_without_valid_document_evidence', usableEvidence };
  }
  if (input.claimType === 'operational' && (successfulTools.length === 0 || !hasRequiredTools)) {
    return { allowed: false, reason: 'operational_claim_without_confirmed_tool_result', usableEvidence };
  }
  if (input.claimType === 'mixed' && (!hasDocument || successfulTools.length === 0 || !hasRequiredTools)) {
    return { allowed: false, reason: 'mixed_claim_requires_document_and_operational_evidence', usableEvidence };
  }
  return { allowed: true, reason: 'grounded', usableEvidence };
}

