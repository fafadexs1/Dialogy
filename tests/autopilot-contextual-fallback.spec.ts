import { describe, expect, it } from 'vitest';

import {
  buildContextualAutopilotFallback,
  isGenericInstabilityReply,
} from '@/services/autopilot/contextual-fallback';

describe('contextual autopilot fallback', () => {
  it('answers a plans request from factual knowledge when the model fails', () => {
    const response = buildContextualAutopilotFallback({
      intent: 'pricing_request',
      customerMessage: 'Os planos de internet',
      configuredFallback: 'Estou com uma instabilidade para responder agora.',
      knowledgeDocuments: [{
        id: 'catalog',
        name: 'Catalogo oficial de planos de internet',
        category: 'commercial_plan_catalog',
        contextRole: 'fact',
        priority: 100,
        content: '500 MEGA - R$99,90/mes\n1000 MEGA - R$149,90/mes',
      }],
    });

    expect(response).toContain('500 MEGA - R$99,90/mes');
    expect(response).toContain('Qual dessas opcoes mais te interessou?');
    expect(response.toLowerCase()).not.toContain('instabilidade');
  });

  it('rejects configured generic instability messages', () => {
    expect(isGenericInstabilityReply(
      'Estou com uma instabilidade para responder agora. Pode aguardar um instante? Nossa equipe vai acompanhar por aqui.',
    )).toBe(true);

    const response = buildContextualAutopilotFallback({
      intent: 'troubleshooting',
      customerMessage: 'Minha internet caiu',
      configuredFallback: 'Estou com uma instabilidade para responder agora.',
    });

    expect(response).toContain('diagnostico automatico');
    expect(response.toLowerCase()).not.toContain('instabilidade');
  });
});
