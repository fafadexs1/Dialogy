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

  it('scopes official catalog answers by requested terms in non-telecom niches', () => {
    const menuDocument: KnowledgeBaseDocument = {
      id: 'menu-filtered',
      name: 'Cardapio oficial',
      category: 'menu',
      content: [
        'Cardapio oficial',
        '',
        'Pizza media',
        'Mussarela tradicional',
        'R$49,90',
        '',
        '',
        'Combo familia',
        'Pizza grande + refrigerante',
        'R$89,90',
        '',
        '',
        'Prato vegetariano',
        'Legumes grelhados',
        'R$39,90',
      ].join('\n'),
    };

    const comboResolution = resolveAutopilotIntent({
      customerMessage: 'Me mostra apenas os combos',
      knowledgeDocuments: [menuDocument],
    });

    expect(comboResolution.intent).toBe('catalog_request');
    expect(comboResolution.officialResponse).toContain('Combo familia');
    expect(comboResolution.officialResponse).not.toContain('Pizza media');
    expect(comboResolution.officialResponse).not.toContain('Prato vegetariano');

    const vegetarianResolution = resolveAutopilotIntent({
      customerMessage: 'Tem opção vegetariana?',
      knowledgeDocuments: [menuDocument],
    });

    expect(vegetarianResolution.officialResponse).toContain('Prato vegetariano');
    expect(vegetarianResolution.officialResponse).not.toContain('Combo familia');
  });

  it('routes billing, scheduling and human requests deterministically', () => {
    expect(resolveAutopilotIntent({ customerMessage: 'Preciso da segunda via do boleto' }).intent).toBe('billing_or_payment');
    expect(resolveAutopilotIntent({ customerMessage: 'Quero agendar uma consulta amanha' }).intent).toBe('scheduling_request');
    expect(resolveAutopilotIntent({ customerMessage: 'Qual o valor da consulta e do retorno?' }).intent).toBe('pricing_request');
    expect(resolveAutopilotIntent({ customerMessage: 'Tem alguma promocao ou cupom hoje?' }).intent).toBe('promotion_request');
    expect(resolveAutopilotIntent({ customerMessage: 'Tem disponibilidade para amanha?' }).intent).toBe('availability_request');

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

  it('keeps short unresolved follow-ups in the active troubleshooting context', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: 'Nao resolveu',
      chatHistory: 'Cliente: Problemas de conexao',
    });

    expect(resolution.intent).toBe('troubleshooting');
    expect(resolution.reason).toContain('follow-up curto');
  });

  it('does not let catalog history override explicit billing requests', () => {
    const history = [
      'Atendente: Deseja conhecer nossas opcoes de servicos?',
      'Atendente: 1. Assinar Internet',
      'Atendente: 4. Financeiro',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Pode me mandar as 2 faturas em aberto?',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('billing_or_payment');
    expect(resolution.officialResponse).toBeUndefined();
  });

  it('does not use exported conversation transcripts as official answers', () => {
    const transcriptDocument: KnowledgeBaseDocument = {
      id: 'conversation-1',
      name: 'Conversa - Eric Trindade - 13/05/2026',
      category: 'product_or_service_catalog',
      content: [
        'Cliente: Ola',
        'Atendente: Ola, sou o assistente virtual.',
        'Cliente: Quanto ta os plano?',
        'Atendente: Temos planos de internet.',
        'Cliente: Tem pro jardim inga?',
      ].join('\n'),
    };

    const official = findOfficialKnowledgeAnswer({
      documents: [transcriptDocument],
      intent: 'catalog_request',
    });

    expect(official).toBeNull();
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

  it('treats a location follow-up after plans as availability intent', () => {
    const history = [
      'Atendente: Temos planos de internet fibra.',
      'Atendente: Para verificar disponibilidade, me informe sua regiao ou bairro.',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Moro no Ocidental Park',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('availability_request');
    expect(resolution.reason).toContain('localizacao');
  });

  it('continues the active workflow when the customer replies with CPF only', () => {
    const history = [
      'Cliente: Quero conhecer os planos',
      'Atendente: Temos planos de internet. Para continuar a contratacao, me informe seu CPF.',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: '06620056199',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('purchase_inquiry');
    expect(resolution.reason).toContain('mantendo o contexto ativo');
    expect(resolution.extractedSlots.customer_identifier).toBe('06620056199');
  });

  it('continues technical support context when the customer replies with CPF only', () => {
    const history = [
      'Cliente: Problemas de conexao',
      'Atendente: Verifique o cabo da fibra e reinicie o modem.',
      'Cliente: Nao resolveu',
      'Atendente: Para verificar o que esta acontecendo, preciso do seu CPF para acessar o sistema.',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: '70280417195',
      chatHistory: history,
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('troubleshooting');
    expect(resolution.reason).toContain('mantendo o contexto ativo');
    expect(resolution.extractedSlots.customer_identifier).toBe('70280417195');
    expect(resolution.officialResponse).toBeUndefined();
  });

  it('recognizes common technical complaints without team routing keywords', () => {
    expect(resolveAutopilotIntent({ customerMessage: 'Minha internet tá ruim' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'Minha internet caiu e nao voltou' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'Meu wifi conecta e cai a cada cinco minutos' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'Minha fibra rompeu depois da chuva' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'Meu wifi fica caindo toda hora' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'A conexao esta muito lenta' }).intent).toBe('troubleshooting');
    expect(resolveAutopilotIntent({ customerMessage: 'O roteador esta com LOS vermelho' }).intent).toBe('troubleshooting');
  });

  it('recognizes explicit handoff requests to named business areas', () => {
    expect(resolveAutopilotIntent({ customerMessage: 'Quero falar com um tecnico do suporte agora' }).intent).toBe('human_handoff');
    expect(resolveAutopilotIntent({ customerMessage: 'Me transfere para o comercial, quero contratar outro ponto' }).intent).toBe('human_handoff');
  });

  it('recognizes complex dissatisfaction as complaint', () => {
    expect(resolveAutopilotIntent({
      customerMessage: 'Estou irritado, a conexao cai todo dia, ja paguei e ninguem resolve',
    }).intent).toBe('complaint');
  });

  it('does not confuse internet purchase intent with troubleshooting', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: 'Quero contratar internet fibra',
      knowledgeDocuments: [catalogDocument],
    });

    expect(resolution.intent).toBe('purchase_inquiry');
  });

  it('continues billing context when the customer replies with CPF only', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: '52998224725',
      chatHistory: [
        'Cliente: Preciso da segunda via do boleto',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
    });

    expect(resolution.intent).toBe('billing_or_payment');
    expect(resolution.reason).toContain('mantendo o contexto ativo');
    expect(resolution.extractedSlots.customer_identifier).toBe('52998224725');
  });

  it('does not turn support continuity into a commercial intent just because the history mentions internet', () => {
    const history = [
      'Cliente: Estou sem conexao na fibra',
      'Atendente: Me informe seu CPF para consultar o cadastro no sistema.',
    ].join('\n');

    const resolution = resolveAutopilotIntent({
      customerMessage: '06620056199',
      chatHistory: history,
    });

    expect(resolution.intent).toBe('troubleshooting');
    expect(resolution.intent).not.toBe('purchase_inquiry');
  });

  it('falls back safely when a CPF-only follow-up has ambiguous context', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: '06620056199',
      chatHistory: [
        'Cliente: Quero contratar, mas tambem estou com problema de conexao',
        'Atendente: Me informe seu CPF para verificar o cadastro.',
      ].join('\n'),
    });

    expect(resolution.intent).toBe('unknown');
    expect(resolution.reason).toContain('ambiguo');
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

  it('scopes official catalog answers to the requested TV packages only', () => {
    const exactPlanDocument: KnowledgeBaseDocument = {
      id: 'plans-tv',
      name: 'Planos de Internet',
      category: 'isp_plan_catalog',
      content: [
        'Voce deve mandar os planos exatamente com o mesmo espacamento e com os emojis.',
        '',
        '\u{1F310} NOSSOS PLANOS DE INTERNET:',
        '',
        '\u{1F4F6} 500 MEGA (somente internet)',
        '\u{1F4E1} Wi-Fi 5',
        '\u{2733} R$99,90/mes valor com desconto de pontualidade',
        '',
        '',
        '\u{1F4F6} 600 MEGA (+ 60 canais de TV)',
        '\u{1F4E1} Wi-Fi 5',
        '\u{2733} R$109,90/mes valor com desconto de pontualidade',
        '',
        '',
        '\u{1F4F6} 1000 MEGA (+ 100 canais de TV)',
        '\u{1F4E1} Wi-Fi 6',
        '\u{2733} R$149,90/mes valor com desconto de pontualidade',
        '',
        '',
        '\u{1F4FA} Quer conhecer os canais de TV?',
        '\u{1F449} https://velpro.net.br/tv',
      ].join('\n'),
    };

    const resolution = resolveAutopilotIntent({
      customerMessage: 'Queria ver apenas os pacotes com tv',
      knowledgeDocuments: [exactPlanDocument],
    });

    expect(resolution.intent).toBe('catalog_request');
    expect(resolution.officialResponsePreserveFormatting).toBe(true);
    expect(resolution.officialResponse).toContain('\u{1F310} NOSSOS PLANOS DE INTERNET:');
    expect(resolution.officialResponse).toContain('600 MEGA (+ 60 canais de TV)');
    expect(resolution.officialResponse).toContain('1000 MEGA (+ 100 canais de TV)');
    expect(resolution.officialResponse).not.toContain('500 MEGA (somente internet)');
    expect(resolution.officialResponse).not.toContain('Quer conhecer os canais de TV?');
    expect(resolution.officialResponse).not.toContain('https://velpro.net.br/tv');
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
