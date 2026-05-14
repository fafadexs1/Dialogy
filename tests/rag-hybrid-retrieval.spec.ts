import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { mergeAndRerankKnowledgeDocuments } from '@/services/rag/hybrid-retrieval';
import type { KnowledgeBaseDocument } from '@/lib/types';

const docs: KnowledgeBaseDocument[] = [
  {
    id: 'catalog',
    name: 'Catalogo oficial',
    category: 'product_or_service_catalog',
    priority: 8,
    content: 'Catalogo de servicos: Essencial, Pro e Enterprise.',
  },
  {
    id: 'pricing',
    name: 'Tabela de precos',
    category: 'pricing',
    priority: 10,
    canonicalAnswer: 'Essencial: R$79,90. Pro: R$129,90.',
    content: 'Precos oficiais dos servicos.',
  },
  {
    id: 'support',
    name: 'Como resolver falhas',
    category: 'troubleshooting',
    content: 'Para erro de acesso, valide cadastro, status e procedimento operacional.',
  },
  {
    id: 'expired',
    name: 'Oferta expirada',
    category: 'offers',
    validUntil: '2020-01-01',
    content: 'Promocao antiga de R$1,00.',
  },
  {
    id: 'persona',
    name: 'Tom de voz',
    category: 'persona',
    content: 'Seja simpatico e profissional.',
  },
];

describe('hybrid RAG deterministic reranker', () => {
  it('selects pricing documents for pricing intents', () => {
    const intent = resolveAutopilotIntent({
      customerMessage: 'Quanto custa o servico Pro?',
      knowledgeDocuments: docs,
    });

    const result = mergeAndRerankKnowledgeDocuments({
      staticDocuments: docs,
      query: 'Quanto custa o servico Pro?',
      intent,
    });

    expect(result.strategy).toBe('static_documents');
    expect(result.knowledgeCoverage).toBe('high');
    expect(result.knowledgeBaseDocuments[0].id).toBe('pricing');
    expect(result.knowledgeBaseDocuments.map((document) => document.id)).not.toContain('expired');
  });

  it('does not let commercial docs dominate troubleshooting', () => {
    const intent = resolveAutopilotIntent({
      customerMessage: 'Estou com erro de acesso e nao funciona',
      knowledgeDocuments: docs,
    });

    const result = mergeAndRerankKnowledgeDocuments({
      staticDocuments: docs,
      query: 'Estou com erro de acesso e nao funciona',
      intent,
    });

    expect(result.knowledgeBaseDocuments[0].id).toBe('support');
    expect(result.selected[0].category).toBe('troubleshooting');
  });

  it('merges vector and static documents while removing duplicate content', () => {
    const vectorDocument: KnowledgeBaseDocument = {
      id: 'vector-pricing',
      name: 'Tabela de precos chunk',
      content: 'Essencial: R$79,90. Pro: R$129,90.',
    };

    const intent = resolveAutopilotIntent({
      customerMessage: 'valores dos servicos',
      knowledgeDocuments: docs,
    });

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [vectorDocument],
      staticDocuments: docs,
      query: 'valores dos servicos',
      intent,
    });

    expect(result.strategy).toBe('vector_static');
    expect(result.knowledgeBaseDocuments.length).toBeGreaterThan(0);
    expect(new Set(result.knowledgeBaseDocuments.map((document) => document.id)).size).toBe(result.knowledgeBaseDocuments.length);
  });

  it('hydrates vector chunks with the full published knowledge document', () => {
    const fullPlanDocument: KnowledgeBaseDocument = {
      id: 'plans-full',
      name: 'Planos de Internet',
      category: 'product_or_service_catalog',
      content: [
        'Voce deve mandar os planos exatamente como estao na base.',
        '',
        '500 MEGA - R$99,90',
        '600 MEGA - R$109,90',
        '800 MEGA - R$125,90',
        '1000 MEGA - R$149,90',
      ].join('\n'),
    };
    const vectorChunk: KnowledgeBaseDocument = {
      id: 'plans-full',
      name: 'Planos de Internet',
      content: '1000 MEGA - R$149,90',
      source: 'vector',
      priority: 100,
    };
    const intent = resolveAutopilotIntent({
      customerMessage: 'Quais planos de internet?',
      knowledgeDocuments: [fullPlanDocument],
    });

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [vectorChunk],
      staticDocuments: [fullPlanDocument],
      query: 'Quais planos de internet?',
      intent,
    });

    expect(result.selected[0]).toMatchObject({
      id: 'plans-full',
      source: 'vector',
    });
    expect(result.knowledgeBaseDocuments[0].content).toContain('500 MEGA');
    expect(result.knowledgeBaseDocuments[0].content).toContain('1000 MEGA');
  });

  it('filters customer conversation artifacts from general RAG selection', () => {
    const transcriptDocument: KnowledgeBaseDocument = {
      id: 'transcript',
      name: 'Conversa - Cliente antigo - 13/05/2026',
      category: 'product_or_service_catalog',
      priority: 100,
      content: [
        'Cliente: Ola',
        'Atendente: Ola, sou o assistente virtual.',
        'Cliente: Quanto custa?',
        'Atendente: O plano Pro custa R$129,90.',
      ].join('\n'),
    };
    const intent = resolveAutopilotIntent({
      customerMessage: 'Quanto custa o plano Pro?',
      knowledgeDocuments: docs,
    });

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [transcriptDocument],
      staticDocuments: [transcriptDocument, ...docs],
      query: 'Quanto custa o plano Pro?',
      intent,
    });

    expect(result.knowledgeBaseDocuments.map((document) => document.id)).not.toContain('transcript');
  });
});
