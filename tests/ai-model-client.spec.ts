import { describe, expect, it } from 'vitest';

import { runAiModelWithFallback } from '@/services/ai/model-client';
import { classifyAiModelError } from '@/services/ai/model-errors';

describe('AI model client', () => {
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
      modelCandidates: ['googleai/gemini-2.0-flash'],
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
      modelCandidates: ['googleai/gemini-2.0-flash'],
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
      modelCandidates: ['googleai/bad-model', 'googleai/gemini-2.0-flash'],
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

    expect(result.result).toEqual({ model: 'googleai/gemini-2.0-flash' });
    expect(result.model).toBe('googleai/gemini-2.0-flash');
    expect(seenModels).toEqual(['googleai/bad-model', 'googleai/gemini-2.0-flash']);
  });
});

