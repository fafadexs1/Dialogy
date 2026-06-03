import { describe, expect, it } from 'vitest';

import { preserveKnowledgeDocumentSource } from '@/ai/flows/knowledge-document-rewrite';

const document = {
  id: 'commercial-flow',
  name: 'Fluxo comercial para novos clientes',
  content: `Use este fluxo para novos clientes.

1. Apresente os planos oficiais.
2. Colete um dado por vez.
3. Confirme os dados recebidos.
4. Avise que a equipe retornara no proximo dia util.
5. Encerre somente depois do aviso.`,
};

describe('knowledge document rewrite safety', () => {
  it('preserves the official source when the model replaces a procedure with a short summary', () => {
    const result = preserveKnowledgeDocumentSource(document, {
      name: 'Fluxo comercial',
      content: 'Use este fluxo quando o cliente quiser contratar.',
      summary: 'Fluxo para orientar novos clientes interessados em contratacao.',
      category: 'commercial_sales_flow',
      tags: ['comercial'],
      contextRole: 'procedure',
      canonicalAnswer: '',
      workflowHints: ['novo cliente'],
      requiredTools: [],
    });

    expect(result.content).toContain('## Resumo para busca');
    expect(result.content).toContain('## Conteudo oficial preservado');
    expect(result.content).toContain('5. Encerre somente depois do aviso.');
  });

  it('keeps a complete rewrite without duplicating the original source', () => {
    const completeRewrite = `${document.content}\n\nResultado esperado: pre-cadastro encaminhado.`;
    const result = preserveKnowledgeDocumentSource(document, {
      name: 'Fluxo comercial',
      content: completeRewrite,
      summary: 'Fluxo comercial completo.',
      category: 'commercial_sales_flow',
      tags: ['comercial'],
      contextRole: 'procedure',
      canonicalAnswer: '',
      workflowHints: ['novo cliente'],
      requiredTools: [],
    });

    expect(result.content).toBe(completeRewrite);
    expect(result.content).not.toContain('## Conteudo oficial preservado');
  });
});
