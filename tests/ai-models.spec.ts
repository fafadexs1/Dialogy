import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_MODEL_CATALOG,
  getAiModelLabel,
  getAutopilotSelectableModels,
  getGoogleAiSdkModelName,
  getWorkspaceGeminiSelectableModels,
  isAutopilotRuntimeSupportedModel,
  normalizeGoogleAiModelId,
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
        id: 'lmstudio/openai/gpt-oss-20b',
        label: 'GPT OSS 20B Local',
        provider: 'lmstudio',
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

    expect(selectable).toHaveLength(2);
    expect(selectable[0].id).toBe('googleai/gemini-2.5-flash-lite');
    expect(selectable[1].id).toBe('lmstudio/openai/gpt-oss-20b');
    expect(isAutopilotRuntimeSupportedModel(selectable[0])).toBe(true);
    expect(isAutopilotRuntimeSupportedModel(selectable[1])).toBe(true);
  });

  it('resolves labels from the catalog and gracefully falls back for unknown ids', () => {
    expect(getAiModelLabel('googleai/gemini-2.0-flash', DEFAULT_AI_MODEL_CATALOG)).toBe('Gemini 2.0 Flash');
    expect(getAiModelLabel('googleai/custom-preview', DEFAULT_AI_MODEL_CATALOG)).toBe('custom-preview');
    expect(getAiModelLabel(null, DEFAULT_AI_MODEL_CATALOG)).toBe('Gemini 2.0 Flash');
  });

  it('normalizes LM Studio ids entered with the native server model id', () => {
    const catalog = parseAiModelCatalog(JSON.stringify([
      {
        id: 'google/gemma-4-e4b',
        label: 'Gemma 4 E4B',
        provider: 'lmstudio',
        enabled: true,
      },
    ]));

    expect(catalog[0].id).toBe('lmstudio/google/gemma-4-e4b');
    expect(getAutopilotSelectableModels(catalog)[0].id).toBe('lmstudio/google/gemma-4-e4b');
  });

  it('normalizes Gemini model ids for workspace auxiliary tasks', () => {
    expect(normalizeGoogleAiModelId('gemini-2.5-flash')).toBe('googleai/gemini-2.5-flash');
    expect(normalizeGoogleAiModelId('models/gemini-2.5-flash')).toBe('googleai/gemini-2.5-flash');
    expect(normalizeGoogleAiModelId('googleai/gemini-2.5-flash')).toBe('googleai/gemini-2.5-flash');
    expect(normalizeGoogleAiModelId('lmstudio/google/gemma-4-e4b')).toBeNull();
    expect(getGoogleAiSdkModelName('googleai/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('lists only enabled Google models for workspace Gemini settings', () => {
    const models = getWorkspaceGeminiSelectableModels([
      { id: 'googleai/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'googleai', enabled: true },
      { id: 'googleai/gemini-disabled', label: 'Gemini Disabled', provider: 'googleai', enabled: false },
      { id: 'lmstudio/google/gemma-4-e4b', label: 'Gemma Local', provider: 'lmstudio', enabled: true },
    ]);

    expect(models.map((model) => model.id)).toEqual(['googleai/gemini-2.5-flash']);
  });
});
