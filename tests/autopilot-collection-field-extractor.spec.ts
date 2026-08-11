import { describe, expect, it } from 'vitest';

import {
  acceptExtractedFields,
  extractCollectionFieldsWithAi,
} from '@/ai/flows/collection-field-extractor';
import {
  acceptCollectionFieldValue,
  extractPendingCollectionReplyFields,
} from '@/services/autopilot/collection-completion';

function keyMap(fields: string[]): Map<string, string> {
  return new Map(fields.map((field, index) => [`field_${index}`, field]));
}

/**
 * Pins the deterministic gap the AI extractor exists to cover. If a change ever
 * makes the parser handle these shapes on its own, the extractor stops firing
 * for them (it only runs on fields still missing) and these expectations should
 * be updated deliberately, not silently.
 */
describe('deterministic collection parser coverage', () => {
  const pendingFields = ['nome', 'telefone', 'email'];
  const previousQuestion = 'Para continuar, me informe nome, telefone e email.';

  function parse(customerMessage: string) {
    return extractPendingCollectionReplyFields({
      customerMessage,
      pendingFields,
      alreadyKnownFields: {},
      previousQuestion,
    });
  }

  it('handles a fully labelled reply', () => {
    expect(parse('nome: Joao Silva, telefone: 11999998888, email: joao@exemplo.com')).toEqual({
      nome: 'Joao Silva',
      telefone: '11999998888',
      email: 'joao@exemplo.com',
    });
  });

  it('drops an unlabelled multi-field reply', () => {
    expect(parse('Joao Silva, 11999998888, joao@exemplo.com')).toEqual({});
  });

  it('drops a line-separated multi-field reply', () => {
    expect(parse('Joao Silva\n11999998888\njoao@exemplo.com')).toEqual({});
  });

  it('drops a single answer while several fields are still pending', () => {
    expect(parse('Joao Silva')).toEqual({});
  });
});

describe('acceptCollectionFieldValue', () => {
  it('accepts a well-formed value for a known field', () => {
    expect(acceptCollectionFieldValue('email', 'joao@exemplo.com')).toBe('joao@exemplo.com');
    expect(acceptCollectionFieldValue('telefone', '11999998888')).toBe('11999998888');
    expect(acceptCollectionFieldValue('nome', 'Joao Silva')).toBe('Joao Silva');
  });

  it('accepts a niche field the deterministic vocabulary does not know', () => {
    expect(acceptCollectionFieldValue('carteirinha do convenio', '9988776655')).toBe('9988776655');
    expect(acceptCollectionFieldValue('placa do veiculo', 'ABC1D23')).toBe('ABC1D23');
  });

  it('rejects a malformed value even when the model returned it confidently', () => {
    expect(acceptCollectionFieldValue('email', 'joao arroba exemplo')).toBeNull();
    expect(acceptCollectionFieldValue('telefone', '123')).toBeNull();
    expect(acceptCollectionFieldValue('cpf', '111.111.111-11')).toBeNull();
  });

  it('rejects a question or a conversational filler as a value', () => {
    expect(acceptCollectionFieldValue('nome', 'qual o seu nome?')).toBeNull();
    expect(acceptCollectionFieldValue('nome', 'obrigado')).toBeNull();
    expect(acceptCollectionFieldValue('nome', 'quero falar com um atendente humano')).toBeNull();
  });

  it('rejects non-string payloads', () => {
    expect(acceptCollectionFieldValue('nome', null)).toBeNull();
    expect(acceptCollectionFieldValue('nome', undefined)).toBeNull();
    expect(acceptCollectionFieldValue('nome', { hack: true })).toBeNull();
    expect(acceptCollectionFieldValue('nome', ['Joao'])).toBeNull();
  });
});

describe('acceptExtractedFields', () => {
  it('maps indexed keys back to the real field names', () => {
    const accepted = acceptExtractedFields(
      { field_0: 'Joao Silva', field_1: '11999998888', field_2: 'joao@exemplo.com' },
      keyMap(['nome completo', 'telefone', 'email']),
    );

    expect(accepted).toEqual({
      'nome completo': 'Joao Silva',
      telefone: '11999998888',
      email: 'joao@exemplo.com',
    });
  });

  it('drops nulls for fields the customer did not answer', () => {
    const accepted = acceptExtractedFields(
      { field_0: 'Joao Silva', field_1: null, field_2: undefined },
      keyMap(['nome', 'telefone', 'email']),
    );

    expect(accepted).toEqual({ nome: 'Joao Silva' });
  });

  it('keeps the valid fields and drops only the invalid one', () => {
    const accepted = acceptExtractedFields(
      { field_0: 'Joao Silva', field_1: 'nao sei meu telefone' },
      keyMap(['nome', 'telefone']),
    );

    expect(accepted).toEqual({ nome: 'Joao Silva' });
  });

  it('ignores keys the model invented outside the requested schema', () => {
    const accepted = acceptExtractedFields(
      { field_0: 'Joao Silva', field_99: 'valor fantasma', admin: true },
      keyMap(['nome']),
    );

    expect(accepted).toEqual({ nome: 'Joao Silva' });
  });

  it('tolerates a malformed model payload', () => {
    expect(acceptExtractedFields({}, keyMap(['nome']))).toEqual({});
    expect(acceptExtractedFields({ field_0: '' }, keyMap(['nome']))).toEqual({});
  });
});

describe('extractCollectionFieldsWithAi', () => {
  // These return before any provider call, so they need no network.
  it('does nothing when no field is pending', async () => {
    await expect(extractCollectionFieldsWithAi({
      customerMessage: 'Joao Silva, 11999998888',
      pendingFields: [],
    })).resolves.toEqual({});
  });

  it('does nothing for an empty message', async () => {
    await expect(extractCollectionFieldsWithAi({
      customerMessage: '   ',
      pendingFields: ['nome'],
    })).resolves.toEqual({});
  });

  it('does not send an oversized message to the provider', async () => {
    await expect(extractCollectionFieldsWithAi({
      customerMessage: 'x'.repeat(2_001),
      pendingFields: ['nome'],
    })).resolves.toEqual({});
  });
});
