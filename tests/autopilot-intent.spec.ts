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

  it('treats short specific option selections after a catalog as purchase intent', () => {
    const exactPlanDocument: KnowledgeBaseDocument = {
      id: 'plans-exact',
      name: 'Planos Velpro',
      category: 'product_or_service_catalog',
      content: [
        'Voce deve mandar os planos exatamente com o mesmo espacamento e com os emojis.',
        '',
        'NOSSOS PLANOS DE INTERNET:',
        '',
        '500 MEGA (somente internet)',
        'R$99,90/mes valor com desconto de pontualidade',
        '',
        '1000 MEGA (+ 100 canais de TV)',
        'Wi-Fi 6',
        'R$149,90/mes valor com desconto de pontualidade',
      ].join('\n'),
    };
    const history = [
      'Atendente: NOSSOS PLANOS DE INTERNET:',
      '500 MEGA (somente internet)',
      '1000 MEGA (+ 100 canais de TV)',
      'Algum desses planos te interessou?',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Esse de 1000 MEGA',
      chatHistory: history,
      knowledgeDocuments: [exactPlanDocument],
    });

    expect(resolution.intent).toBe('purchase_inquiry');
    expect(resolution.reason).toContain('selecionou uma opcao especifica');
  });

  it('treats price-based selections after a catalog as purchase intent', () => {
    const history = [
      'Atendente: NOSSOS PLANOS DE INTERNET:',
      '500 MEGA (somente internet)',
      'R$99,90/mes valor com desconto de pontualidade',
      '1000 MEGA (+ 100 canais de TV)',
      'R$149,90/mes valor com desconto de pontualidade',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Esse de R$99,90',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('purchase_inquiry');
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

  it('uses literal plan documents that require exact spacing and emojis', () => {
    const exactPlanDocument: KnowledgeBaseDocument = {
      id: 'plans-exact',
      name: 'Planos Velpro',
      content: [
        'Voce deve mandar os planos exatamente com o mesmo espacamento e com os emojis.',
        '',
        '\u{1F310} NOSSOS PLANOS DE INTERNET:',
        '',
        '\u{1F4F6} 500 MEGA (somente internet)',
        '\u{1F4E1} Wi-Fi 5',
        '\u{2733} R$99,90/mes valor com desconto de pontualidade',
        '\u{1F911}  R$109,90/mes valor do plano',
        '',
        '',
        '\u{1F4F6} 1000 MEGA (+ 100 canais de TV)',
        '\u{1F4E1} Wi-Fi 6 (ultima geracao)',
        '\u{2733} R$149,90/mes valor com desconto de pontualidade',
        '\u{1F911}  R$159,90/mes valor do plano',
      ].join('\n'),
    };

    const resolution = resolveAutopilotIntent({
      customerMessage: 'me manda os planos de internet',
      knowledgeDocuments: [exactPlanDocument],
    });

    expect(resolution.shouldUseLlm).toBe(false);
    expect(resolution.officialResponsePreserveFormatting).toBe(true);
    expect(resolution.officialResponse).toContain('\u{1F310} NOSSOS PLANOS DE INTERNET:');
    expect(resolution.officialResponse).toContain('\u{1F911}  R$109,90/mes valor do plano');
    expect(resolution.officialResponse).toContain('valor do plano\n\n\n\u{1F4F6} 1000 MEGA');
    expect(resolution.officialResponse).not.toContain('Voce deve mandar');
  });

  it('answers only the promotional block when the customer asks for the promo plan', () => {
    const exactPlanDocument: KnowledgeBaseDocument = {
      id: 'plans-with-promo',
      name: 'Planos Velpro',
      content: [
        'Voce deve mandar os planos exatamente com o mesmo espacamento e com os emojis.',
        '',
        '\u{1F310} NOSSOS PLANOS DE INTERNET:',
        '',
        '\u{1F4F6} 500 MEGA (somente internet)',
        '\u{1F4E1} Wi-Fi 5',
        '\u{2733} R$99,90/mes valor com desconto de pontualidade',
        '\u{1F911}  R$109,90/mes valor do plano',
        '',
        '',
        'Plano de internet.',
        '',
        '\u{1F381} PROMOCAO DE ABRIL\u{1F381}\u{1F31E}',
        '',
        '\u{1F4F6} 1000 MEGAS + 60 CANAIS! \u{1F929}',
        '\u{1F4E1} Wi-Fi 6',
        '',
        '\u{2705} R$99,90/mes valor com desconto de pontualidade (ate o vencimento)',
        '\u{1F911} R$119,90/mes valor do plano (apos vencimento)',
        '',
        '\u{1F4FA} Quer conhecer os canais de TV?',
        '\u{1F449} https://velpro.net.br/tv',
        'Clique no link acima',
        '',
        'Oferta valida ate 06/05/2026.',
      ].join('\n'),
    };

    const promoResolution = resolveAutopilotIntent({
      customerMessage: 'Me mostra o plano promocional',
      knowledgeDocuments: [exactPlanDocument],
    });

    expect(promoResolution.intent).toBe('promotion_request');
    expect(promoResolution.shouldUseLlm).toBe(false);
    expect(promoResolution.officialResponsePreserveFormatting).toBe(true);
    expect(promoResolution.officialResponse).toContain('\u{1F381} PROMOCAO DE ABRIL');
    expect(promoResolution.officialResponse).toContain('\u{1F4F6} 1000 MEGAS + 60 CANAIS!');
    expect(promoResolution.officialResponse).toContain('Oferta valida ate 06/05/2026.');
    expect(promoResolution.officialResponse).not.toContain('\u{1F310} NOSSOS PLANOS DE INTERNET');
    expect(promoResolution.officialResponse).not.toContain('500 MEGA');

    const purchaseResolution = resolveAutopilotIntent({
      customerMessage: 'Esse plano promocional, acho que quero ele',
      knowledgeDocuments: [exactPlanDocument],
    });

    expect(purchaseResolution.intent).toBe('purchase_inquiry');
    expect(purchaseResolution.shouldUseLlm).toBe(true);
  });
});
