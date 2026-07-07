import { afterEach, describe, expect, it } from 'vitest';

import { resolveFlowBuilderApiKeyForModel } from '@/ai/flows/autopilot-flow-builder';

const ORIGINAL_ENV = {
  GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};

function resetEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('Autopilot Flow Builder model routing', () => {
  afterEach(resetEnv);

  it('uses explicit workspace keys before environment keys', () => {
    process.env.DEEPSEEK_API_KEY = 'env-deepseek-key';

    expect(resolveFlowBuilderApiKeyForModel({
      model: 'deepseek/deepseek-v4-flash',
      explicitApiKey: 'workspace-deepseek-key',
    })).toBe('workspace-deepseek-key');
  });

  it('resolves Gemini, OpenAI/Codex, and DeepSeek environment keys by provider', () => {
    process.env.GOOGLE_GENAI_API_KEY = 'gemini-key';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.CODEX_API_KEY = 'codex-key';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';

    expect(resolveFlowBuilderApiKeyForModel({ model: 'googleai/gemini-2.5-flash-lite' }))
      .toBe('gemini-key');
    expect(resolveFlowBuilderApiKeyForModel({ model: 'openai/gpt-5.4-mini' }))
      .toBe('openai-key');
    expect(resolveFlowBuilderApiKeyForModel({ model: 'codex/gpt-5.3-codex' }))
      .toBe('openai-key');
    expect(resolveFlowBuilderApiKeyForModel({ model: 'deepseek/deepseek-v4-flash' }))
      .toBe('deepseek-key');
  });

  it('falls back to CODEX_API_KEY for Codex/OpenAI-compatible models', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.CODEX_API_KEY = 'codex-key';

    expect(resolveFlowBuilderApiKeyForModel({ model: 'codex/gpt-5.3-codex' }))
      .toBe('codex-key');
  });
});
