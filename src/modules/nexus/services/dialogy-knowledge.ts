import { db } from '@/lib/db';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { compactKnowledgeDocumentsForPrompt } from '@/services/autopilot/knowledge-prompt-budget';
import { isUnsafeAsCustomerFacingKnowledge } from '@/services/rag/document-safety';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';
import { selectNativeKnowledgeDocuments } from '@/services/workflow-runtime/native-knowledge-references';
import type { WorkflowExecution, WorkflowNode } from '@/services/workflow-runtime';
import { isRecord } from '@/services/workflow-runtime/utils';

type Queryable = Pick<typeof db, 'query'>;

export type DialogyKnowledgeLibrary = {
  documents: KnowledgeBaseDocument[];
  collections: KnowledgeCollection[];
};

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export async function loadWorkspaceDialogyKnowledge(
  workspaceId: string,
  database: Queryable = db,
): Promise<DialogyKnowledgeLibrary> {
  const result = await database.query(
    `SELECT id, name, knowledge_base_documents, knowledge_collections
     FROM public.autopilot_configs
     WHERE workspace_id = $1
     ORDER BY CASE WHEN is_active THEN 0 ELSE 1 END,
              CASE WHEN is_primary THEN 0 ELSE 1 END,
              created_at ASC`,
    [workspaceId],
  );
  const documents = new Map<string, KnowledgeBaseDocument>();
  const collections = new Map<string, KnowledgeCollection>();
  collections.set('general', {
    id: 'general',
    name: 'Geral',
    description: 'Conteúdo compartilhado da Dialogy.',
    isDefault: true,
  });

  for (const row of result.rows as Array<Record<string, unknown>>) {
    const agentName = String(row.name || 'Atendente Dialogy');
    for (const collection of parseArray<KnowledgeCollection>(row.knowledge_collections)) {
      if (!collection?.id || collections.has(collection.id)) continue;
      collections.set(collection.id, { ...collection });
    }
    for (const document of parseArray<KnowledgeBaseDocument>(row.knowledge_base_documents)) {
      if (!document?.id || !document.name || !document.content?.trim() || documents.has(document.id)) continue;
      if (document.status === 'archived' || document.status === 'expired' || isUnsafeAsCustomerFacingKnowledge(document)) continue;
      documents.set(document.id, {
        ...document,
        owner: document.owner || agentName,
        collectionIds: document.collectionIds?.length ? document.collectionIds : ['general'],
      });
    }
  }
  return { documents: [...documents.values()], collections: [...collections.values()] };
}

export function nexusKnowledgeQuery(execution: WorkflowExecution): string {
  const candidates: unknown[] = [
    execution.variables.mensagem_usuario,
    execution.variables.agentFollowup,
    execution.variables.answer,
    execution.input.customerMessage,
    execution.input.message,
    execution.input.text,
    isRecord(execution.input.current) ? execution.input.current.customerMessage : undefined,
    isRecord(execution.input.current) ? execution.input.current.message : undefined,
    isRecord(execution.input.current) ? execution.input.current.text : undefined,
  ];
  return candidates.map((value) => typeof value === 'string' ? value.trim() : '').find(Boolean) || 'contexto atual do atendimento';
}

export async function retrieveNexusDialogyKnowledge(input: {
  workspaceId: string;
  execution: WorkflowExecution;
  knowledgeNodes: WorkflowNode[];
  library: DialogyKnowledgeLibrary;
  retrieve?: typeof retrieveHybridSupportContext;
}): Promise<Array<Record<string, unknown>>> {
  const scoped = selectNativeKnowledgeDocuments(input.knowledgeNodes, input.library.documents);
  if (scoped.length === 0) return [];
  const maxDocuments = Math.max(1, Math.min(20, Math.max(...input.knowledgeNodes.map((node) => Number(node.config.maxDocuments || 6)))));
  const retrieve = input.retrieve || retrieveHybridSupportContext;
  const retrieval = await retrieve({
    workspaceId: input.workspaceId,
    query: nexusKnowledgeQuery(input.execution),
    staticDocuments: scoped,
    allowedDocumentIds: scoped.map((document) => document.id),
  });
  return compactKnowledgeDocumentsForPrompt(retrieval.knowledgeBaseDocuments.slice(0, maxDocuments))
    .map((document) => ({ ...document }));
}
