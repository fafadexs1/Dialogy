import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { filterKnowledgeDocumentsForScope } from '@/services/autopilot/flow-routing';
import { mergeAndRerankKnowledgeDocuments } from '@/services/rag/hybrid-retrieval';
import { fuseDocumentMatchesWithRrf } from '@/services/rag/retrieval';
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
  it('uses RRF to reward documents found by both semantic and textual retrieval', () => {
    const base = {
      id: 'chunk',
      content: 'conteudo',
      similarity: 0.8,
      document_name: 'Documento',
      workspace_id: 'workspace',
      autopilot_config_id: 'agent',
      metadata: {},
    };
    const results = fuseDocumentMatchesWithRrf({
      vectorMatches: [
        { ...base, document_id: 'semantic-only' },
        { ...base, id: 'both-vector', document_id: 'both' },
      ],
      keywordMatches: [
        { ...base, id: 'both-keyword', document_id: 'both', keyword_score: 5 },
        { ...base, id: 'keyword-only', document_id: 'keyword-only', keyword_score: 4 },
      ],
    });

    expect(results[0].document_id).toBe('both');
    expect(results[0].retrieval_sources).toEqual(['vector', 'keyword']);
    expect(results[0].rrf_score).toBeGreaterThan(results[1].rrf_score || 0);
  });

  it('limits sub-agent knowledge to authorized collections', () => {
    const scopedDocs: KnowledgeBaseDocument[] = [
      { id: 'legacy', name: 'Geral', content: 'Conteudo legado sem colecao.' },
      { id: 'billing', name: 'Financeiro', content: 'Segunda via.', collectionIds: ['financeiro'] },
      { id: 'technical', name: 'Tecnico', content: 'Instalacao.', collectionIds: ['tecnico'] },
    ];
    const config = {
      flow_graph: {
        version: 1,
        nodes: [
          { id: 'knowledge', kind: 'knowledge', title: 'Conhecimento', subtitle: 'Consultar base', position: { x: 0, y: 0 } },
          { id: 'sub-financeiro', kind: 'intent', title: 'Financeiro', subtitle: 'Sub-agente', position: { x: 0, y: 120 } },
          { id: 'sub-geral', kind: 'intent', title: 'Geral', subtitle: 'Sub-agente', position: { x: 220, y: 120 } },
        ],
        edges: [
          { id: 'knowledge-financeiro', source: 'knowledge', target: 'sub-financeiro' },
          { id: 'knowledge-geral', source: 'knowledge', target: 'sub-geral' },
        ],
        variables: [],
      },
    } as unknown as Parameters<typeof filterKnowledgeDocumentsForScope>[0];

    const financial = filterKnowledgeDocumentsForScope(config, scopedDocs, {
      nodeId: 'sub-financeiro',
      title: 'Financeiro',
      intent: 'billing_or_payment',
      systemPrompt: 'Atenda assuntos financeiros.',
      knowledgeCollectionIds: ['financeiro'],
    });
    const general = filterKnowledgeDocumentsForScope(config, scopedDocs, {
      nodeId: 'sub-geral',
      title: 'Geral',
      intent: 'unknown',
      systemPrompt: 'Atenda assuntos gerais.',
      knowledgeCollectionIds: ['general'],
    });

    expect(financial.map((document) => document.id)).toEqual(['billing']);
    expect(general.map((document) => document.id)).toEqual(['legacy']);
  });

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

  it('puts a factual catalog ahead of a commercial procedure for plan requests', () => {
    const catalog: KnowledgeBaseDocument = {
      id: 'catalog-fact',
      name: 'Catalogo oficial de planos',
      category: 'commercial_plan_catalog',
      contextRole: 'fact',
      content: '500 MEGA por R$99,90.',
    };
    const procedure: KnowledgeBaseDocument = {
      id: 'sales-flow',
      name: 'Fluxo comercial',
      category: 'commercial_sales_flow',
      contextRole: 'procedure',
      content: 'Se pedir planos, consulte o catalogo e pergunte qual plano interessou.',
      source: 'vector',
      priority: 100,
    };
    const intent = resolveAutopilotIntent({
      customerMessage: 'Eu queria ver os planos',
      knowledgeDocuments: [catalog, procedure],
    });

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [procedure, { ...catalog, source: 'vector', priority: 90 }],
      staticDocuments: [catalog, procedure],
      query: 'Eu queria ver os planos',
      intent,
    });

    expect(result.knowledgeBaseDocuments[0].id).toBe('catalog-fact');
  });

  it('prioritizes a specifically named document over a broad document with overlapping content', () => {
    const broadDocument: KnowledgeBaseDocument = {
      id: 'broad',
      name: 'Fluxo comercial completo',
      category: 'commercial_sales_flow',
      content: 'Planos, instalacao e informacoes gerais, incluindo vantagens do Wi-Fi 6 para clientes.',
      source: 'vector',
      priority: 92,
    };
    const specificDocument: KnowledgeBaseDocument = {
      id: 'wifi6',
      name: 'Wi-Fi 6',
      category: 'info_wifi6',
      content: 'Wi-Fi 6 oferece maior capacidade e estabilidade quando varios aparelhos estao conectados.',
    };

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [broadDocument],
      staticDocuments: [broadDocument, specificDocument],
      query: 'O que e Wi-Fi 6 e quais vantagens ele tem?',
    });

    expect(result.knowledgeBaseDocuments[0].id).toBe('wifi6');
  });

  it('prioritizes canonical knowledge over generic vector context for the same subject', () => {
    const genericVectorDocument: KnowledgeBaseDocument = {
      id: 'generic',
      name: 'Manual de atendimento',
      category: 'contact_info',
      content: 'Para contato, o cliente pode procurar o numero da central de atendimento.',
      source: 'vector',
      priority: 98,
    };
    const canonicalDocument: KnowledgeBaseDocument = {
      id: 'central',
      name: 'Numero da Central',
      category: 'contact_info',
      content: 'Informacoes de atendimento.',
      canonicalAnswer: 'O numero para entrar em contato com a Central e 0800 381 0404.',
    };

    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [genericVectorDocument],
      staticDocuments: [genericVectorDocument, canonicalDocument],
      query: 'Qual e o numero da central de atendimento?',
    });

    expect(result.knowledgeBaseDocuments[0].id).toBe('central');
  });

  it('matches reiniciar requests to reboot procedures before transfer context', () => {
    const rebootProcedure: KnowledgeBaseDocument = {
      id: 'reboot',
      name: 'Roteador - reboot',
      category: 'tool_procedure',
      content: 'Reinicie o roteador quando solicitado.',
    };
    const transferProcedure: KnowledgeBaseDocument = {
      id: 'transfer',
      name: 'Transferencia para suporte',
      category: 'handoff_policy',
      content: 'Registre a tentativa de reboot antes de transferir.',
      source: 'vector',
      priority: 80,
    };
    const rebootResult = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [transferProcedure],
      staticDocuments: [rebootProcedure, transferProcedure],
      query: 'Voce consegue reiniciar meu roteador?',
    });

    expect(rebootResult.knowledgeBaseDocuments[0].id).toBe('reboot');
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

  it('preserves only the retrieved vector chunk while inheriting document metadata', () => {
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
    expect(result.knowledgeBaseDocuments[0].content).toContain('1000 MEGA');
    expect(result.knowledgeBaseDocuments[0].content).not.toContain('500 MEGA');
    expect(result.knowledgeBaseDocuments[0].category).toBe('product_or_service_catalog');
  });

  it('keeps only the strongest chunk from each document', () => {
    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [
        {
          id: 'wifi',
          name: 'Roteador e Wi-Fi',
          category: 'troubleshooting',
          content: 'Troca de senha do Wi-Fi.',
          source: 'vector',
          priority: 90,
        },
        {
          id: 'wifi',
          name: 'Roteador e Wi-Fi',
          category: 'troubleshooting',
          content: 'Reinicie o roteador se necessario.',
          source: 'vector',
          priority: 80,
        },
        {
          id: 'fiber',
          name: 'Fibra optica',
          category: 'troubleshooting',
          content: 'Verifique a luz LOS vermelha.',
          source: 'vector',
          priority: 70,
        },
      ],
      query: 'Quero trocar a senha do Wi-Fi',
    });

    expect(result.knowledgeBaseDocuments.map((document) => document.id)).toEqual(['wifi', 'fiber']);
    expect(result.discarded).toContainEqual(expect.objectContaining({
      id: 'wifi',
      reason: 'duplicate_document',
    }));
  });

  it('reports keyword fallback separately from semantic vector retrieval', () => {
    const result = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [{
        id: 'wifi-keyword',
        name: 'Roteador e Wi-Fi',
        category: 'troubleshooting',
        content: 'Troca de senha do Wi-Fi.',
        source: 'keyword',
      }],
      staticDocuments: [{
        id: 'handoff',
        name: 'Transferencia',
        category: 'handoff_policy',
        content: 'Encaminhe para suporte humano quando necessario.',
      }],
      query: 'Quero trocar a senha do Wi-Fi',
    });

    expect(result.strategy).toBe('keyword_static');
    expect(result.selected[0].source).toBe('keyword');
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
