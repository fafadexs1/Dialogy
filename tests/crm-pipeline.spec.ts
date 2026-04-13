import { describe, expect, it } from 'vitest';
import {
  buildFallbackPipelineStages,
  getDefaultPipelineStageValue,
  normalizePipelineStageValue,
  sortPipelineStages,
} from '@/lib/crm-pipeline';

describe('crm pipeline helpers', () => {
  it('normalizes stage values to stable slugs', () => {
    expect(normalizePipelineStageValue(' Reunião Agendada ')).toBe('reuniao_agendada');
    expect(normalizePipelineStageValue('Proposta/Contrato')).toBe('proposta_contrato');
  });

  it('sorts stages by sort order first', () => {
    const stages = sortPipelineStages([
      { id: 'b', label: 'B', value: 'b', color: '#000', is_close_reason: false, sort_order: 300 },
      { id: 'a', label: 'A', value: 'a', color: '#000', is_close_reason: false, sort_order: 100 },
      { id: 'c', label: 'C', value: 'c', color: '#000', is_close_reason: false, sort_order: 200 },
    ]);

    expect(stages.map((stage) => stage.value)).toEqual(['a', 'c', 'b']);
  });

  it('returns the first fallback stage as default when needed', () => {
    expect(getDefaultPipelineStageValue([])).toBe(buildFallbackPipelineStages()[0]?.value);
  });
});
