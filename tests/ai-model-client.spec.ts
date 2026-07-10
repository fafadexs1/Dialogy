import { describe, expect, it } from 'vitest';

import { runAiModelWithFallback } from '@/services/ai/model-client';
import { classifyAiModelError } from '@/services/ai/model-errors';

describe('AI model client', () => {
  it('classifies a missing configured model as retryable so fallback can continue', () => {
    expect(classifyAiModelError(new Error(
      "NOT_FOUND: Model 'deepseek/deepseek-v4-flash' not found",
    ))).toMatchObject({
      code: 'model_unavailable',
      retryable: true,
    });
  });

  it('classifies invalid API keys as non-retryable auth errors', () => {
    const classification = classifyAiModelError(new Error('API_KEY_INVALID: API key not valid'));

    expect(classification).toMatchObject({
      code: 'auth_error',
      retryable: false,
    });
  });

  it('classifies rate limits and timeouts as retryable', () => {
    const rateLimitError = new Error('Resource exhausted due to quota');
    (rateLimitError as any).status = 429;

    expect(classifyAiModelError(rateLimitError)).toMatchObject({
      code: 'rate_limit',
      retryable: true,
      status: 429,
    });

    expect(classifyAiModelError(new Error('llm response timed out after 20000ms'))).toMatchObject({
      code: 'timeout',
      retryable: true,
    });
  });

  it('retries retryable failures on the same key/model before succeeding', async () => {
    let calls = 0;

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['googleai/gemini-2.5-flash'],
      apiKeyCandidates: [{ source: 'agent', key: 'agent-key' }],
      maxAttemptsPerCandidate: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error('Service unavailable');
          (error as any).status = 503;
          throw error;
        }
        return { ok: true };
      },
    });

    expect(calls).toBe(2);
    expect(result.result).toEqual({ ok: true });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['error', 'success']);
  });

  it('falls back to the next API key after an auth error', async () => {
    const seenSources: string[] = [];

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['googleai/gemini-2.5-flash'],
      apiKeyCandidates: [
        { source: 'agent', key: 'bad-key' },
        { source: 'workspace', key: 'good-key' },
      ],
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ keySource }) => {
        seenSources.push(keySource);
        if (keySource === 'agent') {
          throw new Error('API key not valid');
        }
        return 'ok';
      },
    });

    expect(result.result).toBe('ok');
    expect(result.keySource).toBe('workspace');
    expect(seenSources).toEqual(['agent', 'workspace']);
  });

  it('falls back to the next model after a retryable model failure', async () => {
    const seenModels: string[] = [];

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['googleai/bad-model', 'googleai/gemini-2.5-flash'],
      apiKeyCandidates: [{ source: 'env', key: 'env-key' }],
      maxAttemptsPerCandidate: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ model }) => {
        seenModels.push(model);
        if (model === 'googleai/bad-model') {
          const error = new Error('Model temporarily unavailable');
          (error as any).status = 503;
          throw error;
        }
        return { model };
      },
    });

    expect(result.result).toEqual({ model: 'googleai/gemini-2.5-flash' });
    expect(result.model).toBe('googleai/gemini-2.5-flash');
    expect(seenModels).toEqual(['googleai/bad-model', 'googleai/gemini-2.5-flash']);
  });

  it('only attempts models with compatible provider keys', async () => {
    const seenPairs: string[] = [];

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['deepseek/deepseek-v4-flash', 'openai/gpt-5.5'],
      apiKeyCandidates: [
        { source: 'env-gemini', key: 'gemini-key', provider: 'googleai' },
        { source: 'env-openai', key: 'openai-key', provider: 'openai' },
      ],
      maxAttemptsPerCandidate: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ keySource, model }) => {
        seenPairs.push(`${keySource}:${model}`);
        return { model };
      },
    });

    expect(result.model).toBe('openai/gpt-5.5');
    expect(result.keySource).toBe('env-openai');
    expect(seenPairs).toEqual(['env-openai:openai/gpt-5.5']);
  });

  it('prioritizes the selected model before fallback provider keys', async () => {
    const seenPairs: string[] = [];

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['deepseek/deepseek-v4-flash', 'googleai/gemini-2.5-flash'],
      apiKeyCandidates: [
        { source: 'agent-gemini', key: 'leaked-gemini-key', provider: 'googleai' },
        { source: 'workspace-deepseek', key: 'deepseek-key', provider: 'deepseek' },
      ],
      maxAttemptsPerCandidate: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ keySource, model }) => {
        seenPairs.push(`${keySource}:${model}`);
        return { model };
      },
    });

    expect(result.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.keySource).toBe('workspace-deepseek');
    expect(seenPairs).toEqual(['workspace-deepseek:deepseek/deepseek-v4-flash']);
  });

  it('does not keep trying an auth-failed key across fallback models', async () => {
    const seenPairs: string[] = [];

    await expect(runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['googleai/gemini-2.5-flash-lite', 'googleai/gemini-2.5-flash'],
      apiKeyCandidates: [
        { source: 'agent-gemini', key: 'leaked-gemini-key', provider: 'googleai' },
      ],
      maxAttemptsPerCandidate: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ keySource, model }) => {
        seenPairs.push(`${keySource}:${model}`);
        throw new Error('Your API key was reported as leaked.');
      },
    })).rejects.toMatchObject({
      code: 'auth_error',
    });

    expect(seenPairs).toEqual(['agent-gemini:googleai/gemini-2.5-flash-lite']);
  });

  it('falls back across providers when the selected provider fails', async () => {
    const seenPairs: string[] = [];

    const result = await runAiModelWithFallback({
      label: 'test',
      modelCandidates: ['deepseek/deepseek-v4-flash', 'openai/gpt-5.5'],
      apiKeyCandidates: [
        { source: 'env-deepseek', key: 'deepseek-key', provider: 'deepseek' },
        { source: 'env-openai', key: 'openai-key', provider: 'openai' },
      ],
      maxAttemptsPerCandidate: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      execute: async ({ keySource, model }) => {
        seenPairs.push(`${keySource}:${model}`);
        if (model.startsWith('deepseek/')) {
          const error = new Error('DeepSeek temporarily unavailable');
          (error as any).status = 503;
          throw error;
        }
        return { model };
      },
    });

    expect(result.model).toBe('openai/gpt-5.5');
    expect(result.keySource).toBe('env-openai');
    expect(seenPairs).toEqual([
      'env-deepseek:deepseek/deepseek-v4-flash',
      'env-openai:openai/gpt-5.5',
    ]);
  });
});

