import { describe, expect, it } from 'vitest';

import { maskConversationText, nameTokens } from '@/lib/privacy/mask-conversation-pii';

describe('conversation PII masking', () => {
  it('masks documents, contacts and addresses of the person', () => {
    const out = maskConversationText('CPF 123.456.789-00, cnpj 12.345.678/0001-95, fone (11) 98765-4321, CEP 01310-100, a@b.com');
    expect(out).toBe('CPF [CPF], cnpj [CNPJ], fone [TEL], CEP [CEP], [EMAIL]');
  });

  it('masks unformatted numbers and links', () => {
    // 11 unformatted digits are ambiguous between CPF and mobile; either label is fine, the digits must go.
    const out = maskConversationText('meu cpf 12345678900 e 11987654321 http://x.co/a?b=1');
    expect(out).not.toMatch(/\d/);
    expect(out).toMatch(/^meu cpf \[(CPF|TEL)\] e \[(CPF|TEL)\] \[URL\]$/);
  });

  it('masks long digit runs that are not recognised shapes', () => {
    expect(maskConversationText('contrato 1234567890123')).toBe('contrato [NUM]');
  });

  it('masks a CPF typed with spaces and boleto-style grouped digits', () => {
    expect(maskConversationText('meu cpf 123 456 789-00')).toBe('meu cpf [NUM]');
    expect(maskConversationText('linha 12345.67890 12345.678901 12345.678901 1 12345678901234')).not.toMatch(/\d{6}/);
  });

  it('masks Pix copy-and-paste payloads and long tokens glued to letters', () => {
    const pix = '00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540510.005802BR';
    expect(maskConversationText(`pague: ${pix} obrigado`)).toBe('pague: [CODIGO] obrigado');
    expect(maskConversationText('protocolo ID1234567 aberto')).toBe('protocolo ID[NUM] aberto');
  });

  it('keeps dates, amounts and short ids readable', () => {
    expect(maskConversationText('vence 10/11/2026 valor 89,99 fatura 12345')).toBe('vence 10/11/2026 valor 89,99 fatura 12345');
  });

  it('keeps short numbers that carry meaning for the decision', () => {
    expect(maskConversationText('quero o plano 600 mega, dia 10')).toBe('quero o plano 600 mega, dia 10');
  });

  it('masks the contact name as whole words only, case-insensitively', () => {
    const names = nameTokens('Maria da Silva', null);
    expect(names).toEqual(['Maria', 'Silva']);
    expect(maskConversationText('Oi, sou a maria SILVA. Mariana é minha filha', names)).toBe('Oi, sou a [NOME] [NOME]. Mariana é minha filha');
  });

  it('truncates very long messages', () => {
    expect(maskConversationText('palavra '.repeat(1000), [], 100)).toHaveLength(100);
  });
});
