import type { KnowledgeBaseDocument } from '@/lib/types';
import type { WorkflowDefinition, WorkflowNode } from './types';

type RemovedKnowledgeReference = {
  documentId?: string;
  collectionId?: string;
};

function removeValue(values: unknown, removedValue?: string): unknown {
  if (!removedValue || !Array.isArray(values)) return values;
  return values.map(String).filter((value) => value !== removedValue);
}

function reconcileRetrieverNode(
  node: WorkflowNode,
  removed: RemovedKnowledgeReference,
): WorkflowNode {
  if (node.type !== 'knowledge.rag_retriever') return node;

  const documentIds = removeValue(node.config.documentIds, removed.documentId);
  const currentFilters = node.config.filters && typeof node.config.filters === 'object' && !Array.isArray(node.config.filters)
    ? node.config.filters as Record<string, unknown>
    : {};
  const collectionIds = removeValue(currentFilters.collectionIds, removed.collectionId);
  const filters = collectionIds === currentFilters.collectionIds
    ? currentFilters
    : { ...currentFilters, collectionIds };

  if (documentIds === node.config.documentIds && filters === currentFilters) return node;
  return {
    ...node,
    config: {
      ...node.config,
      documentIds,
      filters,
    },
  };
}

export function removeNativeKnowledgeReferences(
  definition: WorkflowDefinition,
  removed: RemovedKnowledgeReference,
): WorkflowDefinition {
  const nodes = definition.nodes.map((node) => reconcileRetrieverNode(node, removed));
  if (nodes.every((node, index) => node === definition.nodes[index])) return definition;
  return {
    ...definition,
    nodes,
    updatedAt: new Date().toISOString(),
  };
}

export function selectNativeKnowledgeDocuments(
  knowledgeNodes: WorkflowNode[],
  documents: KnowledgeBaseDocument[],
): KnowledgeBaseDocument[] {
  const documentIds = new Set(knowledgeNodes.flatMap((node) => (
    Array.isArray(node.config.documentIds) ? node.config.documentIds.map(String) : []
  )));
  const collectionIds = new Set(knowledgeNodes.flatMap((node) => {
    const filters = node.config.filters && typeof node.config.filters === 'object' && !Array.isArray(node.config.filters)
      ? node.config.filters as Record<string, unknown>
      : {};
    return Array.isArray(filters.collectionIds) ? filters.collectionIds.map(String) : [];
  }));
  return documents.filter((document) => {
    if (documentIds.size > 0 && !documentIds.has(document.id)) return false;
    if (collectionIds.size === 0) return true;
    const memberships = document.collectionIds?.length ? document.collectionIds : ['general'];
    return memberships.some((collectionId) => collectionIds.has(collectionId));
  });
}
