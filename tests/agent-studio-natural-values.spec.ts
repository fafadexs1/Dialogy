import { describe, expect, it } from 'vitest';
import { normalizeStudioDirectAnswer } from '@/services/agent-studio/natural-values';
import { validateStudioField } from '@/services/agent-studio/collection';
import { CollectedFieldDefinitionSchema } from '@/services/agent-studio/types';
const now = Date.parse('2026-09-05T01:00:00Z');
const field = (type: string) => CollectedFieldDefinitionSchema.parse({ id: 'value', variableKey: 'value', name: 'Dado', promptMessage: 'Informe o dado', type, options: ['A', 'B'] });
describe('domain-neutral natural structured values', () => {
  it.each([
    ['date', 'hoje', '2026-09-04'], ['date', 'quero marcar para amanhã', '2026-09-05'],
    ['date', 'depois de amanhã', '2026-09-06'], ['time', 'às 14h30', '14:30'],
    ['time', '2 da tarde', '14:00'], ['time', '9 da manhã', '09:00'],
    ['number', 'quero duas unidades', 2], ['number', 'zero', 0], ['number', 'prefiro 3', 3],
    ['multi_select', 'ambos', ['A', 'B']], ['multi_select', 'quero todas as opções', ['A', 'B']],
  ])('%s accepts %s without asking an LLM to invent a value', (type, text, expected) => {
    const definition = field(type);
    expect(validateStudioField(definition, normalizeStudioDirectAnswer(definition, String(text), now, 'America/Sao_Paulo'))).toEqual({ valid: true, value: expected });
  });
  it.each(['amanhã?', 'amanhã ou depois', 'talvez amanhã', 'não quero amanhã', 'se puder amanhã'])('does not accept uncertainty: %s', (text) => {
    expect(normalizeStudioDirectAnswer(field('date'), text, now, 'America/Sao_Paulo')).toBeUndefined();
  });
  it('uses the configured timezone, not the server date', () => {
    expect(normalizeStudioDirectAnswer(field('date'), 'hoje', now, 'UTC')).toBe('2026-09-05');
  });
  it('does not bypass field range validation', () => {
    const definition = field('number'); definition.maxValue = 1;
    expect(validateStudioField(definition, normalizeStudioDirectAnswer(definition, 'duas', now, 'UTC')).valid).toBe(false);
    expect(validateStudioField(field('time'), normalizeStudioDirectAnswer(field('time'), '25h', now, 'UTC')).valid).toBe(false);
  });
});
