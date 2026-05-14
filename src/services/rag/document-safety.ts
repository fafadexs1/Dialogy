import type { KnowledgeBaseDocument } from '@/lib/types';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getDocumentValue(document: KnowledgeBaseDocument, keys: string[]): unknown {
  const raw = document as KnowledgeBaseDocument & Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

export function getCanonicalKnowledgeAnswer(document: KnowledgeBaseDocument): string {
  const value = getDocumentValue(document, ['canonicalAnswer', 'canonical_answer']);
  return typeof value === 'string' ? value.trim() : '';
}

export function isCustomerConversationArtifact(document: KnowledgeBaseDocument): boolean {
  const name = normalize(String(document.name || ''));
  const content = String(document.content || '');
  const normalizedContent = normalize(content.slice(0, 5000));
  const transcriptLabelMatches = content.match(/\b(?:Cliente|Atendente|Agente|Usu[aá]rio|Usuario|Bot|Customer|Agent|User|Assistant)\s*:/gi) || [];

  return (
    /^conversa\b/.test(name) ||
    /^chat\b/.test(name) ||
    /^conversation\b/.test(name) ||
    name.includes('historico de conversa') ||
    name.includes('historico do chat') ||
    name.includes('conversation history') ||
    transcriptLabelMatches.length >= 4 ||
    /\b(?:cliente|customer|user):\s+[\s\S]+\b(?:atendente|agent|assistant|bot):\s+/.test(normalizedContent)
  );
}

export function isUnsafeAsCustomerFacingKnowledge(document: KnowledgeBaseDocument): boolean {
  return isCustomerConversationArtifact(document) && !getCanonicalKnowledgeAnswer(document);
}
