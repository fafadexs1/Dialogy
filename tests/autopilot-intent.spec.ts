import { describe, expect, it } from 'vitest';

import {
  findOfficialPlanCatalog,
  isInternetPlanInquiry,
  resolveAutopilotIntent,
} from '@/services/autopilot-intent';
import type { KnowledgeBaseDocument } from '@/lib/types';

const planDocument: KnowledgeBaseDocument = {
  id: 'plans-1',
  name: 'Preço dos Planos de Internet',
  content: [
    'Nao mude nada na lista. Mande dessa forma para o cliente:',
    '',
    '🚀 *CONHEÇA NOSSOS PLANOS DE INTERNET FIBRA*',
    '',
    '💡 *PLANOS SOMENTE INTERNET*',
    '',
    '🔹 *100 MEGA*',
    '💰 R$79,99/mês',
    '',
    '🔹 *300 MEGA*',
    '💰 R$89,90/mês',
    '',
    '🔹 *500 MEGA*',
    '💰 R$99,90/mês',
  ].join('\n'),
};

describe('autopilot intent resolver', () => {
  it('detects informal customer requests for plan prices', () => {
    expect(isInternetPlanInquiry('Quero conhecer sim. Me mostra os valor')).toBe(true);
    expect(isInternetPlanInquiry('me manda todos')).toBe(true);
  });

  it('uses recent plan offer context for affirmative follow-ups', () => {
    const history = 'Atendente: Deseja conhecer nossos planos de internet?';

    expect(isInternetPlanInquiry('quero sim', history)).toBe(true);
  });

  it('selects price/plan documents as the official plan catalog', () => {
    const promoDocument: KnowledgeBaseDocument = {
      id: 'promo-1',
      name: 'Plano Promocional',
      content: 'PROMOÇÃO ESPECIAL 1000 MEGA R$99,90/mês',
    };

    const catalog = findOfficialPlanCatalog([promoDocument, planDocument]);

    expect(catalog?.document.id).toBe('plans-1');
    expect(catalog?.content).toContain('🚀 *CONHEÇA NOSSOS PLANOS');
    expect(catalog?.content).not.toContain('Nao mude nada');
  });

  it('returns a structured catalog intent with source document metadata', () => {
    const resolution = resolveAutopilotIntent({
      customerMessage: 'Me mostra os valor',
      knowledgeDocuments: [planDocument],
    });

    expect(resolution.intent).toBe('catalogo_planos');
    expect(resolution.confidence).toBeGreaterThan(0.9);
    expect(resolution.sourceDocumentName).toBe('Preço dos Planos de Internet');
    expect(resolution.officialResponse).toContain('*500 MEGA*');
  });
});
