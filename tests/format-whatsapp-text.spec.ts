import { describe, expect, it } from 'vitest';
import { formatWhatsappText } from '@/lib/utils';

describe('formatWhatsappText', () => {
  it('keeps formatted CPF values visible while applying markdown around them', () => {
    const html = formatWhatsappText('CPF *confirmado*: 123.456.789-10');

    expect(html).toContain('<b>confirmado</b>');
    expect(html).toContain('123.456.789-10');
    expect(html).not.toContain('@@DIALOGY_PROTECTED');
  });

  it('keeps formatted CNPJ values visible', () => {
    const html = formatWhatsappText('CNPJ 12.345.678/0001-99 liberado');

    expect(html).toContain('12.345.678/0001-99');
    expect(html).not.toContain('@@DIALOGY_PROTECTED');
  });

  it('keeps compact document values visible', () => {
    const html = formatWhatsappText('Documento 52998224725 recebido');

    expect(html).toContain('52998224725');
    expect(html).not.toContain('@@DIALOGY_PROTECTED');
  });

  it.each(['Pode sim', 'Somente w', 'Obrigada'])('does not inject line breaks into short customer text: %s', (content) => {
    const html = formatWhatsappText(content);

    expect(html).toBe(content);
    expect(html).not.toContain('<br>');
  });
});
