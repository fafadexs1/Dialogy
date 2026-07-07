import { describe, expect, it } from 'vitest';

import { buildOpenAiCompatibleJsonSystemPrompt } from '@/services/ai/openai-compatible';

describe('OpenAI-compatible JSON prompting', () => {
  const jsonSchema = {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
    },
    required: ['ok'],
    additionalProperties: false,
  };

  it('keeps OpenAI prompts lean because json_schema enforces the contract', () => {
    expect(buildOpenAiCompatibleJsonSystemPrompt({
      provider: 'openai',
      systemPrompt: 'Base prompt',
      schemaName: 'test_schema',
      jsonSchema,
    })).toBe('Base prompt');
  });

  it('embeds the JSON schema for DeepSeek json_object mode', () => {
    const prompt = buildOpenAiCompatibleJsonSystemPrompt({
      provider: 'deepseek',
      systemPrompt: 'Base prompt',
      schemaName: 'test_schema',
      jsonSchema,
    });

    expect(prompt).toContain('Base prompt');
    expect(prompt).toContain('test_schema');
    expect(prompt).toContain('"required":["ok"]');
    expect(prompt).toContain('Retorne somente um objeto JSON');
  });
});
