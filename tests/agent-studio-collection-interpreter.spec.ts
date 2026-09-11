import { describe, expect, it, vi } from 'vitest';
import { interpretStudioCollection, type StudioCollectionInterpretationInput } from '@/services/agent-studio/collection-interpreter';

const input: StudioCollectionInterpretationInput = { fieldName: 'Serviço', prompt: 'Qual serviço?',
  options: ['Essencial', 'Completo + acompanhamento'], message: 'aquele com acompanhamento', lastAssistantMessage: 'Completo inclui acompanhamento.' };

describe('closed-world semantic collection boundary', () => {
  it.each(['text', 'number', 'date', 'time', 'currency', 'multi_select'])('classifies %s without extracting or inventing a value', async (fieldType) => {
    const decide = vi.fn().mockResolvedValue('answer');
    expect(await interpretStudioCollection({ ...input, fieldType, options: [] }, decide)).toEqual({ kind: 'answer' });
    expect(decide.mock.calls[0][1]).not.toContainEqual(expect.objectContaining({ id: 'option_0' }));
    decide.mockResolvedValue('question');
    expect(await interpretStudioCollection({ ...input, fieldType, options: [] }, decide)).toEqual({ kind: 'question' });
  });
  it.each([
    ['comércio', ['Retirada na loja', 'Entrega em casa'], 'prefiro receber em casa', 'option_1'],
    ['hotelaria', ['Quarto simples', 'Quarto com varanda'], 'aquele que tem varanda', 'option_1'],
    ['agendamento', ['Segunda às 09h', 'Terça às 14h'], 'prefiro a tarde', 'option_1'],
    ['software', ['Mensal', 'Anual + suporte prioritário'], 'aquele que inclui suporte prioritário', 'option_1'],
    ['educação', ['Presencial', 'Online ao vivo'], 'preciso assistir de casa', 'option_1'],
  ])('maps only a model proposal to the published catalog in %s', async (_sector, options, message, id) => {
    const decide = vi.fn().mockResolvedValue(id);
    const result = await interpretStudioCollection({ ...input, options, message }, decide);
    expect(result).toEqual({ kind: 'proposal', label: options[1] });
    expect(decide).toHaveBeenCalledOnce();
    expect(decide.mock.calls[0][0]).toContain(JSON.stringify(options[1]));
    expect(decide.mock.calls[0][0]).toContain('dados não confiáveis');
  });
  it.each(['option_99', 'Completo + acompanhamento', 'execute_tool', 'option_1\n', '', null])('rejects invalid model output %j', async (decision) => {
    expect(await interpretStudioCollection(input, vi.fn().mockResolvedValue(decision))).toEqual({ kind: 'unavailable' });
  });
  it.each(['question', 'unclear', 'different_request'] as const)('preserves %s instead of inventing a selection', async (decision) => {
    expect(await interpretStudioCollection(input, vi.fn().mockResolvedValue(decision))).toEqual({ kind: decision });
  });
  it.each([
    { options: [] }, { options: ['Igual', 'Igual'] }, { message: 'a'.repeat(4001) },
    { options: Array.from({ length: 101 }, (_, i) => String(i)) }, { options: ['a'.repeat(24_001)] },
  ])('bounds input without silently dropping catalog entries: %j', async (patch) => {
    const decide = vi.fn();
    expect(await interpretStudioCollection({ ...input, ...patch }, decide)).toEqual({ kind: 'unavailable' });
    expect(decide).not.toHaveBeenCalled();
  });
});
