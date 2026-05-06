import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_MODEL_CATALOG,
  getAiModelLabel,
  getAutopilotSelectableModels,
  isAutopilotRuntimeSupportedModel,
  parseAiModelCatalog,
} from '@/lib/ai-models';

describe('ai model catalog', () => {
  it('falls back to defaults when stored data is invalid', () => {
    expect(parseAiModelCatalog('not-json')).toEqual(DEFAULT_AI_MODEL_CATALOG);
    expect(parseAiModelCatalog('{"foo":"bar"}')).toEqual(DEFAULT_AI_MODEL_CATALOG);
  });

  it('keeps only enabled runtime-supported models for autopilot selection', () => {
    const catalog = parseAiModelCatalog(JSON.stringify([
      {
        id: 'googleai/gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite',
        provider: 'googleai',
        enabled: true,
      },
      {
        id: 'openai/gpt-5.2-mini',
        label: 'GPT 5.2 Mini',
        provider: 'openai',
        enabled: true,
      },
      {
        id: 'googleai/gemini-1.5-pro',
        label: 'Gemini 1.5 Pro',
        provider: 'googleai',
        enabled: false,
      },
      {
        id: 'googleai/gemini-3.1-flash-lite-preview',
        label: 'Gemini Preview',
        provider: 'googleai',
        enabled: true,
      },
    ]));

    const selectable = getAutopilotSelectableModels(catalog);

    expect(selectable).toHaveLength(1);
    expect(selectable[0].id).toBe('googleai/gemini-2.5-flash-lite');
    expect(isAutopilotRuntimeSupportedModel(selectable[0])).toBe(true);
  });

  it('resolves labels from the catalog and gracefully falls back for unknown ids', () => {
    expect(getAiModelLabel('googleai/gemini-2.0-flash', DEFAULT_AI_MODEL_CATALOG)).toBe('Gemini 2.0 Flash');
    expect(getAiModelLabel('googleai/custom-preview', DEFAULT_AI_MODEL_CATALOG)).toBe('custom-preview');
    expect(getAiModelLabel(null, DEFAULT_AI_MODEL_CATALOG)).toBe('Gemini 2.0 Flash');
  });
});
