import { describe, expect, it } from 'vitest';

import {
  appendNativeWorkflowTestHistory,
  createNativeWorkflowFixtureDrafts,
  parseNativeWorkflowTestHistory,
  validateNativeWorkflowTestDraft,
} from '@/components/workflow/native-workflow-test-dialog';

describe('native workflow test dialog', () => {
  it('builds guided dependency fixtures and returns a typed payload', () => {
    const dependencies = [{ id: 'load_customer', label: 'Carregar cliente', required: true, defaultOutput: { id: '1' } }];
    const fixtures = createNativeWorkflowFixtureDrafts(dependencies);
    const validation = validateNativeWorkflowTestDraft({
      dependencies,
      fixtureMode: 'required',
      draft: {
        message: 'Preciso da minha fatura',
        fixturesEnabled: true,
        fixtures,
      },
    });

    expect(validation.errors).toEqual({});
    expect(validation.payload).toEqual({
      message: 'Preciso da minha fatura',
      fixtures: { load_customer: { output: { id: '1' } } },
    });
  });

  it('reports message and JSON errors next to their fields', () => {
    const validation = validateNativeWorkflowTestDraft({
      dependencies: [{ id: 'previous', label: 'Anterior', required: true }],
      fixtureMode: 'required',
      draft: {
        message: ' ',
        fixturesEnabled: true,
        fixtures: { previous: { outputJson: '{invalid', statePatchJson: '' } },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.message).toContain('Digite uma mensagem');
    expect(validation.errors['fixture.previous.output']).toContain('JSON inválido');
  });

  it('keeps a bounded, recoverable history and ignores malformed storage', () => {
    const first = { id: '1', submittedAt: '2026-07-12T00:00:00.000Z', message: 'Primeiro', fixtures: {} };
    const second = { id: '2', submittedAt: '2026-07-12T00:01:00.000Z', message: 'Segundo', fixtures: {} };
    const history = appendNativeWorkflowTestHistory([first], second, 1);

    expect(history).toEqual([second]);
    expect(parseNativeWorkflowTestHistory(JSON.stringify(history))).toEqual([second]);
    expect(parseNativeWorkflowTestHistory('{invalid')).toEqual([]);
  });
});
