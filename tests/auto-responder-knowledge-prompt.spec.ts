import { describe, expect, it } from 'vitest';

import { enrichKnowledgeDocumentsForPrompt } from '@/ai/flows/auto-responder';

/**
 * A curadoria da base de conhecimento nao chegava ao modelo.
 *
 * O documento carrega resumo, resposta ja validada e papel (fato, procedimento,
 * politica, persona), mas o KnowledgeDocumentSchema so declarava id/name/
 * content/summary — e o zod descarta o que nao esta declarado. O template, por
 * sua vez, renderizava apenas nome e conteudo.
 *
 * Resultado: o agente recebia a materia-prima e reformulava do zero uma
 * resposta que ja existia pronta e revisada por uma pessoa, sem saber se
 * aquilo era regra inegociavel ou informacao consultiva.
 *
 * Estes testes travam o enriquecimento na entrada. A renderizacao em si e
 * verificada por inspecao do template, que e handlebars e nao roda isolado.
 */

const base = {
  id: 'doc-1',
  name: 'Politica de reembolso',
  content: 'Reembolso em ate 7 dias corridos apos a solicitacao.',
};

describe('enrichKnowledgeDocumentsForPrompt', () => {
  it('preserva a resposta canonica em camelCase', () => {
    const [doc] = enrichKnowledgeDocumentsForPrompt([
      { ...base, canonicalAnswer: 'O reembolso sai em ate 7 dias corridos.' },
    ]);

    expect(doc.canonicalAnswer).toBe('O reembolso sai em ate 7 dias corridos.');
  });

  it('aceita a grafia snake_case dos documentos antigos', () => {
    // Sem esta normalizacao o zod descartaria o campo e a resposta validada
    // sumiria do prompt sem nenhum aviso.
    const [doc] = enrichKnowledgeDocumentsForPrompt([
      { ...base, canonical_answer: 'Resposta antiga preservada.' },
    ]);

    expect(doc.canonicalAnswer).toBe('Resposta antiga preservada.');
  });

  it('infere o papel do documento quando nao foi preenchido a mao', () => {
    const [doc] = enrichKnowledgeDocumentsForPrompt([
      { ...base, category: 'policy' },
    ]);

    expect(doc.contextRole).toBeTruthy();
  });

  it('respeita o papel explicito quando existe', () => {
    const [doc] = enrichKnowledgeDocumentsForPrompt([
      { ...base, contextRole: 'policy' },
    ]);

    expect(doc.contextRole).toBe('policy');
  });

  it('sem resposta canonica devolve null, nao string vazia', () => {
    // null some do template pelo {{#if}}; string vazia renderizaria um rotulo
    // orfao ("RESPOSTA JA VALIDADA:" sem nada depois), gastando token e
    // confundindo o modelo.
    const [doc] = enrichKnowledgeDocumentsForPrompt([base]);

    expect(doc.canonicalAnswer).toBeNull();
  });

  it('nao perde os campos que ja existiam', () => {
    const [doc] = enrichKnowledgeDocumentsForPrompt([
      { ...base, summary: 'Resumo curto.' },
    ]);

    expect(doc.name).toBe('Politica de reembolso');
    expect(doc.content).toContain('7 dias');
    expect(doc.summary).toBe('Resumo curto.');
  });

  it('lida com lista vazia e ausente', () => {
    expect(enrichKnowledgeDocumentsForPrompt([])).toEqual([]);
    expect(enrichKnowledgeDocumentsForPrompt(undefined as never)).toEqual([]);
  });
});
