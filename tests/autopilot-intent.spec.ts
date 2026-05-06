import { describe, expect, it } from 'vitest';

import {
  findOfficialKnowledgeAnswer,
  findOfficialPlanCatalog,
  isInternetPlanInquiry,
  resolveAutopilotIntent,
} from '@/services/autopilot-intent';
import type { KnowledgeBaseDocument } from '@/lib/types';

const catalogDocument: KnowledgeBaseDocument = {
  id: 'catalog-1',
  name: 'Catalogo de servicos',
  category: 'product_or_service_catalog',
  priority: 10,
  content: [
    'Nao mude nada na lista. Mande dessa forma para o cliente:',
    '',
    '*Catalogo oficial*',
    '',
    'Servico Essencial: R$79,90/mensal',
    'Servico Pro: R$129,90/mensal',
  ].join('\n'),
};

describe('autopilot universal intent resolver', () => {
  it('detects legacy ISP plan inquiries without making telecom the core intent', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: 'Me mostra os planos e valores',
      knowledgeDocuments: [catalogDocument],
    });

    expect(isInternetPlanInquiry('Me mostra os planos de internet')).toBe(true);
    expect(resolution.intent).toBe('catalog_request');
    expect(resolution.workflowId).toBe('universal.catalog_request');
    expect(resolution.officialResponse).toContain('Servico Pro');
  });

  it('detects catalog requests for non-telecom niches', () => {
    const menuDocument: KnowledgeBaseDocument = {
      id: 'menu-1',
      name: 'Cardapio oficial',
      category: 'menu',
      canonicalAnswer: '*Cardapio*\nPizza media: R$49,90\nCombo familia: R$89,90',
      content: 'Cardapio atualizado do restaurante.',
    };

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Me manda o cardapio por favor',
      knowledgeDocuments: [menuDocument],
    });

    expect(resolution.intent).toBe('catalog_request');
    expect(resolution.officialResponse).toContain('Pizza media');
    expect(resolution.shouldUseLlm).toBe(false);
  });

  it('routes billing, scheduling and human requests deterministically', () => {
    expect(resolveAutopilotIntent({ customerMessage: 'Preciso da segunda via do boleto' }).intent).toBe('billing_or_payment');
    expect(resolveAutopilotIntent({ customerMessage: 'Quero agendar uma consulta amanha' }).intent).toBe('scheduling_request');

    const handoff = resolveAutopilotIntent({ customerMessage: 'Quero falar com um atendente humano' });
    expect(handoff.intent).toBe('human_handoff');
    expect(handoff.shouldTransfer).toBe(true);
  });

  it('uses recent catalog offer context for affirmative follow-ups', () => {
    const history = 'Atendente: Deseja conhecer nossas opcoes de servicos?';

    const resolution = resolveAutopilotIntent({
      customerMessage: 'quero sim',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('catalog_request');
    expect(resolution.confidence).toBeGreaterThan(0.8);
  });

  it('does not use expired official documents', () => {
    const expiredDocument: KnowledgeBaseDocument = {
      id: 'expired-1',
      name: 'Promocao antiga',
      category: 'offers',
      validUntil: '2020-01-01',
      canonicalAnswer: 'Oferta antiga por R$1,00',
      content: 'Oferta expirada.',
    };

    const official = findOfficialKnowledgeAnswer({
      documents: [expiredDocument],
      intent: 'promotion_request',
    });

    expect(official).toBeNull();
  });

  it('keeps compatibility helper for official plan catalogs', () => {
    const catalog = findOfficialPlanCatalog([catalogDocument]);

    expect(catalog?.document.id).toBe('catalog-1');
    expect(catalog?.content).toContain('*Catalogo oficial*');
    expect(catalog?.content).not.toContain('Nao mude nada');
  });
});
