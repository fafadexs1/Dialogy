import { describe, expect, it } from 'vitest';

import { formatCustomerFacingAiResponse } from '@/lib/ai-response-format';

describe('AI customer response formatting', () => {
  it('splits long single-block responses into short WhatsApp paragraphs', () => {
    const response = [
      'Excelente escolha! Esse plano de 1000 MEGA com Wi-Fi 6 vai garantir velocidade e estabilidade para seus jogos e home office.',
      'Para prosseguirmos com a contratacao, preciso apenas de alguns dados basicos: nome completo, CPF e telefone de contato com WhatsApp.',
      'Assim que voce me enviar, vou encaminhar seu cadastro para nossa equipe realizar a instalacao.',
    ].join(' ');

    const formatted = formatCustomerFacingAiResponse(response);

    expect(formatted).toContain('\n\n');
    expect(formatted.split('\n\n').length).toBeGreaterThanOrEqual(2);
    expect(formatted.length).toBeLessThanOrEqual(520);
  });

  it('keeps only the essential part of unnecessarily large responses', () => {
    const response = [
      'Peço desculpas pela confusao anterior.',
      'Temos uma oferta especial disponivel agora com 1000 MEGA e Wi-Fi 6 por R$ 99,90.',
      'Ela atende bem jogos, streaming e home office.',
      'Tambem posso explicar todos os detalhes tecnicos do roteador, condicoes comerciais, instalacao, contrato, prazos e demais informacoes se voce quiser.',
      'Alem disso, posso comparar com cada plano antigo e listar todas as vantagens uma por uma.',
    ].join(' ');

    const formatted = formatCustomerFacingAiResponse(response, 180);

    expect(formatted.length).toBeLessThanOrEqual(180);
    expect(formatted).toContain('oferta especial');
    expect(formatted).not.toContain('comparar com cada plano antigo');
  });
});
