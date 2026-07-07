import { describe, expect, it } from 'vitest';

import {
  getAiCredentialModelProvider,
  normalizeAiCredentialModel,
} from '@/lib/ai-provider-credentials';

describe('AI provider credentials', () => {
  it('normalizes Gemini model IDs for workspace credentials', () => {
    expect(normalizeAiCredentialModel('gemini', 'gemini-2.5-flash-lite'))
      .toBe('googleai/gemini-2.5-flash-lite');
    expect(normalizeAiCredentialModel('gemini', 'models/gemini-2.5-flash'))
      .toBe('googleai/gemini-2.5-flash');
  });

  it('normalizes OpenAI and Codex model IDs without crossing providers', () => {
    expect(normalizeAiCredentialModel('openai', 'gpt-5.4-mini'))
      .toBe('openai/gpt-5.4-mini');
    expect(normalizeAiCredentialModel('openai', 'codex/gpt-5.3-codex'))
      .toBe('codex/gpt-5.3-codex');
    expect(normalizeAiCredentialModel('openai', 'deepseek/deepseek-v4-flash'))
      .toBeNull();
  });

  it('normalizes DeepSeek model IDs without crossing providers', () => {
    expect(normalizeAiCredentialModel('deepseek', 'deepseek-v4-flash'))
      .toBe('deepseek/deepseek-v4-flash');
    expect(normalizeAiCredentialModel('deepseek', 'openai/gpt-5.4-mini'))
      .toBeNull();
  });

  it('maps credential models back to catalog providers', () => {
    expect(getAiCredentialModelProvider('googleai/gemini-2.5-flash-lite')).toBe('googleai');
    expect(getAiCredentialModelProvider('openai/gpt-5.4-mini')).toBe('openai');
    expect(getAiCredentialModelProvider('codex/gpt-5.3-codex')).toBe('codex');
    expect(getAiCredentialModelProvider('deepseek/deepseek-v4-flash')).toBe('deepseek');
  });
});
