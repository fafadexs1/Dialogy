import { describe, expect, it } from 'vitest';
import { isValidBrazilianDocument, normalizeBrazilianDocument } from '@/lib/brazilian-document';

describe('Brazilian document check digits', () => {
  it.each(['529.982.247-25', '11144477735', '86675273191', '04.252.011/0001-10', '11222333000181', '12.ABC.345/01DE-35'])('accepts valid document %s', document => {
    expect(isValidBrazilianDocument(document)).toBe(true);
  });
  it.each(['', '52998224724', '5299822472', '11111111111', '00000000000000', '04252011000111', '12ABC34501DE34', '52998224725!', 'cpf 52998224725'])('rejects invalid document %s', document => {
    expect(isValidBrazilianDocument(document)).toBe(false);
  });
  it('keeps CNPJ letters and removes presentation punctuation', () => {
    expect(normalizeBrazilianDocument('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });
});
