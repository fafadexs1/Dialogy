import { describe, expect, it } from 'vitest';

import {
  normalizeAiProviderHealthModel,
  testAiProviderConnection,
} from '@/services/ai/provider-health';

describe('AI provider health checks', () => {
  it('normalizes provider model ids without mixing providers', () => {
    expect(normalizeAiProviderHealthModel({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
    })).toMatchObject({
      model: 'googleai/gemini-2.5-flash-lite',
      runtimeProvider: 'googleai',
    });

    expect(normalizeAiProviderHealthModel({
      provider: 'openai',
      model: 'gpt-5.4-mini',
    })).toMatchObject({
      model: 'openai/gpt-5.4-mini',
      runtimeProvider: 'openai',
    });

    expect(normalizeAiProviderHealthModel({
      provider: 'openai',
      model: 'codex/gpt-5.3-codex',
    })).toMatchObject({
      model: 'codex/gpt-5.3-codex',
      runtimeProvider: 'openai',
    });

    expect(normalizeAiProviderHealthModel({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      runtimeProvider: 'deepseek',
    });
  });

  it('rejects mismatched model ids before making a network call', () => {
    expect(normalizeAiProviderHealthModel({
      provider: 'deepseek',
      model: 'openai/gpt-5.4-mini',
    })).toMatchObject({
      model: 'openai/gpt-5.4-mini',
      runtimeProvider: 'openai',
      error: 'Modelo DeepSeek invalido.',
    });
  });

  it('reports missing provider keys without making a network call', async () => {
    const result = await testAiProviderConnection({
      provider: 'openai',
      model: 'openai/gpt-5.4-mini',
      apiKey: '',
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'missing_key',
      model: 'openai/gpt-5.4-mini',
      runtimeProvider: 'openai',
    });
  });
});
