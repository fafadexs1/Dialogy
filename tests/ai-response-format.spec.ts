import { describe, expect, it } from 'vitest';

import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';

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

  it('adds WhatsApp line breaks to compact plan catalogs generated as one paragraph', () => {
    const response = [
      'Com certeza! CONHECA NOSSOS PLANOS DE INTERNET FIBRA - PLANOS SOMENTE INTERNET',
      '500 MEGA Wi-Fi 5 R$99,90/mes pagando em dia R$109,90/mes - PLANOS COM INTERNET + TV',
      '600 MEGA + 60 CANAIS Wi-Fi 5 R$109,90/mes pagando em dia R$119,90/mes',
      '800 MEGA + 75 CANAIS Wi-Fi 5 R$125,90/mes pagando em dia R$135,90/mes',
      '1000 MEGA + 100 CANAIS Wi-Fi 6 R$149,90/mes pagando em dia R$159,90/mes',
    ].join(' ');

    const formatted = formatCustomerFacingAiResponse(response);

    expect(formatted).toContain('PLANOS SOMENTE INTERNET\n\n500 MEGA\nWi-Fi 5\nR$99,90/mes pagando em dia\nR$109,90/mes');
    expect(formatted).toContain('PLANOS COM INTERNET + TV\n\n600 MEGA + 60 CANAIS\nWi-Fi 5\nR$109,90/mes pagando em dia\nR$119,90/mes');
    expect(formatted).not.toContain('500 MEGA Wi-Fi 5 R$99,90');
  });

  it('adds WhatsApp line breaks to compact one-plan promotion blocks', () => {
    const response = [
      'PROMOCAO DE ABRIL (Valida ate 06/05/2026) 1000 MEGAS + 60 CANAIS',
      'Wi-Fi 6 R$99,90/mes pagando em dia R$119,90/mes Para ver a lista completa de canais, acesse: https://velpro.net.br/tv',
      'Algum desses planos te interessou? Se sim, me envie seu CPF e endereco para eu confirmar a cobertura para voce!',
    ].join(' ');

    const formatted = formatCustomerFacingAiResponse(response);

    expect(formatted).toContain('PROMOCAO DE ABRIL (Valida ate 06/05/2026)\n\n1000 MEGAS + 60 CANAIS\nWi-Fi 6\nR$99,90/mes pagando em dia\nR$119,90/mes');
    expect(formatted).toContain('acesse:\nhttps://velpro.net.br/tv');
    expect(formatted).toContain('\n\nAlgum desses planos te interessou?');
    expect(formatted).not.toContain('1000 MEGAS + 60 CANAIS Wi-Fi 6 R$99,90');
  });

  it('preserves WhatsApp spacing for full internet plan catalogs', () => {
    const response = [
      '🚀 *CONHECA NOSSOS PLANOS DE INTERNET FIBRA*',
      'Velocidade, estabilidade e tecnologia pra voce!',
      '',
      '━━━━━━━━━━━━━━━',
      '',
      '💡 *PLANOS SOMENTE INTERNET*',
      '',
      '🔹 *100 MEGA*',
      '📶 Wi-Fi 5',
      '💰 R$79,99/mes pagando em dia',
      '💰 R$89,99/mes',
      '',
      '🔹 *300 MEGA*',
      '📶 Wi-Fi 5',
      '💰 R$89,90/mes pagando em dia',
      '💰 R$95,90/mes',
      '',
      '🔹 *500 MEGA*',
      '📶 Wi-Fi 5',
      '💰 R$99,90/mes pagando em dia',
      '💰 R$109,90/mes',
      '',
      '━━━━━━━━━━━━━━━',
      '',
      '📺 *PLANOS COM INTERNET + TV*',
      '',
      '🔹 *600 MEGA + 60 CANAIS*',
      '📶 Wi-Fi 5',
      '💰 R$109,90/mes pagando em dia',
      '💰 R$119,90/mes',
      '',
      '🔹 *800 MEGA + 75 CANAIS*',
      '📶 Wi-Fi 5',
      '💰 R$125,90/mes pagando em dia',
      '💰 R$135,90/mes',
      '',
      '🔹 *1000 MEGA + 100 CANAIS*',
      '📶 Wi-Fi 6',
      '💰 R$149,90/mes pagando em dia',
      '💰 R$159,90/mes',
      '',
      '━━━━━━━━━━━━━━━',
      '',
      '📡 *Quer ver todos os canais?*',
      '👉 https://velpro.net.br/tv',
    ].join('\n');

    const formatted = formatCustomerFacingAiResponse(response);

    expect(formatted).toContain('💡 *PLANOS SOMENTE INTERNET*');
    expect(formatted).toContain('📺 *PLANOS COM INTERNET + TV*');
    expect(formatted).toContain('🔹 *1000 MEGA + 100 CANAIS*');
    expect(formatted).toContain('📡 *Quer ver todos os canais?*');
    expect(formatted).toContain('💡 *PLANOS SOMENTE INTERNET*\n\n🔹 *100 MEGA*');
    expect(formatted).toContain('💰 R$149,90/mes pagando em dia\n💰 R$159,90/mes');
    expect(formatted).not.toContain('...');
  });

  it('formats ISO dates and timestamps before sending them to the customer', () => {
    const formatted = formatCustomerFacingAiResponse(
      'Ultima atividade: 2026-05-30T09:42:00-03:00. Vencimento: 2026-06-28.'
    );

    expect(formatted).toContain('30/05/2026 09:42');
    expect(formatted).toContain('28/06/2026');
    expect(formatted).not.toContain('2026-05-30T09:42:00-03:00');
  });

  it('preserves complete URLs without inserting spaces at dots', () => {
    const url = 'https://velpro.sgp.tsmx.com.br/boleto/928213-G4L8OY0UBT/';
    const formatted = formatCustomerFacingAiResponse([
      '*Fatura atual*',
      'Numero: 886081',
      'Vencimento: 2026-06-10',
      'Valor: R$ 54,95',
      'Link para pagamento:',
      url,
    ].join('\n'));

    expect(formatted).toContain(url);
    expect(formatted).not.toContain('velpro. sgp');
    expect(formatted).not.toContain('tsmx. com');
  });

  it('keeps generic structured operational details readable', () => {
    const formatted = formatCustomerFacingAiResponse([
      '*Contrato principal*',
      'Status: Online',
      'Plano: 500 MEGA',
      'Endereco: Quadra 20',
    ].join('\n'));

    expect(formatted).toBe([
      '*Contrato principal*',
      'Status: Online',
      'Plano: 500 MEGA',
      'Endereco: Quadra 20',
    ].join('\n'));
  });

  it('splits long structured cards only between sections', () => {
    const firstUrl = 'https://velpro.sgp.tsmx.com.br/boleto/928213-G4L8OY0UBT/';
    const secondUrl = 'https://velpro.sgp.tsmx.com.br/boleto/928214-022IAX78IE/';
    const formatted = formatCustomerFacingAiResponse([
      'Encontrei 2 faturas em aberto para pagamento.',
      '',
      '*Fatura atual*',
      'Numero: 886081',
      'Vencimento: 10/06/2026',
      'Valor: R$ 54,95',
      'Link para pagamento:',
      firstUrl,
      '',
      '*Proxima fatura*',
      'Numero: 886082',
      'Vencimento: 10/07/2026',
      'Valor: R$ 54,95',
      'Link para pagamento:',
      secondUrl,
    ].join('\n'));
    const blocks = splitIntoMessageBlocks(formatted);

    expect(blocks.join('\n\n')).toContain(firstUrl);
    expect(blocks.join('\n\n')).toContain(secondUrl);
    expect(blocks.some((block) => block.includes(firstUrl) && block.includes('928214'))).toBe(false);
  });
});
