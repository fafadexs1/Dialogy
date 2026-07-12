import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getRagKnowledgeSelection } from '@/components/workflow/native-specialized-inspectors';
import type { KnowledgeBaseDocument } from '@/lib/types';

const documents: KnowledgeBaseDocument[] = [
  {
    id: 'faq',
    name: 'Perguntas frequentes',
    content: 'Conteúdo da FAQ',
    status: 'active',
    collectionIds: ['support'],
  },
  {
    id: 'policy',
    name: 'Política comercial',
    content: 'Conteúdo da política',
    status: 'draft',
    collectionIds: ['sales'],
  },
  {
    id: 'general',
    name: 'Informações gerais',
    content: 'Conteúdo geral',
  },
  {
    id: 'archived',
    name: 'Documento antigo',
    content: 'Conteúdo antigo',
    status: 'archived',
    collectionIds: ['support'],
  },
  {
    id: 'expired',
    name: 'Campanha encerrada',
    content: 'Conteúdo expirado',
    status: 'expired',
    collectionIds: ['sales'],
  },
];

describe('native workflow knowledge inspector', () => {
  it('treats an empty document selection as an explicit all-documents default', () => {
    const selection = getRagKnowledgeSelection(documents, [], []);

    expect(selection.mode).toBe('all');
    expect(selection.implicitAll).toBe(true);
    expect(selection.scopedDocuments.map((document) => document.id)).toEqual(['faq', 'policy', 'general']);
    expect(selection.availableDocuments.map((document) => document.id)).not.toContain('archived');
    expect(selection.availableDocuments.map((document) => document.id)).not.toContain('expired');
  });

  it('distinguishes a partial selection and ignores stale or duplicate ids', () => {
    const selection = getRagKnowledgeSelection(documents, [], ['faq', 'faq', 'missing']);

    expect(selection.mode).toBe('partial');
    expect(selection.implicitAll).toBe(false);
    expect(selection.selectedDocumentIds).toEqual(['faq']);
  });

  it('recognizes all documents when they were selected explicitly', () => {
    const selection = getRagKnowledgeSelection(documents, ['support'], ['faq']);

    expect(selection.mode).toBe('all');
    expect(selection.implicitAll).toBe(false);
    expect(selection.scopedDocuments.map((document) => document.id)).toEqual(['faq']);
  });

  it('reports an empty scope and maps documents without memberships to general', () => {
    expect(getRagKnowledgeSelection(documents, ['empty'], []).mode).toBe('empty');
    expect(getRagKnowledgeSelection(documents, ['general'], []).scopedDocuments.map((document) => document.id)).toEqual(['general']);
  });

  it('keeps the guided bulk actions, accessible search and knowledge-management CTA in the editor contract', () => {
    const source = readFileSync('src/components/workflow/native-specialized-inspectors.tsx', 'utf8');

    expect(source).toContain('onManageKnowledge?: () => void');
    expect(source).toContain('Criar ou importar documento');
    expect(source).toContain('Selecionar tudo');
    expect(source).toContain('Limpar seleção');
    expect(source).toContain('aria-label="Buscar documentos da base de conhecimento"');
    expect(source).toContain('Nenhum documento nestas coleções');
    expect(source).toContain('Ajustes da busca');
  });
});
