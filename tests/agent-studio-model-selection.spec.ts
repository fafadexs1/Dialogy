import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), prompt: vi.fn(), usage: vi.fn() }));
vi.mock('@/ai/genkit', () => ({ ai: { defineFlow: (_definition: unknown, execute: unknown) => execute, definePrompt: () => mocks.prompt } }));
vi.mock('@/actions/autopilot', () => ({ logAutopilotUsage: mocks.usage }));
vi.mock('@/services/ai/provider-keys', () => ({ getDefaultGeminiEnvKey: () => 'isolated-key', resolveAiProviderKeyCandidates: async () => [{ key: 'isolated-key', provider: 'google', source: 'test' }] }));
vi.mock('@/services/ai/model-client', () => ({ runAiModelWithFallback: mocks.run, assertAiModelOutput: vi.fn() }));
vi.mock('@/services/ai/lm-studio', () => ({ isLmStudioModel: () => false, getGlobalLmStudioConfig: vi.fn(), defineLmStudioPrompt: vi.fn(), coerceLmStudioPromptOutput: vi.fn() }));
vi.mock('@/services/ai/openai-compatible', () => ({ isOpenAiCompatibleModel: () => false, defineOpenAiCompatiblePrompt: vi.fn(), coerceOpenAiCompatiblePromptOutput: vi.fn() }));
import { generateProcedureRuntimeOutput } from '@/ai/flows/procedure-runtime';

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('AI_PROCEDURE_RUNTIME_MODEL', 'environment-override');
  mocks.prompt.mockResolvedValue({ output: { decision: 'invoice' } }); mocks.usage.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async (request) => ({ result: await request.execute({ model: request.modelCandidates[0], apiKey: 'isolated-key' }), model: request.modelCandidates[0] }));
});
afterEach(() => vi.unstubAllEnvs());

describe('published Studio model selection at the actual shared AI flow boundary', () => {
  const input = { config: { id: 'agent' }, chatId: 'chat', mode: 'decision' as const, model: 'published-model', customerMessage: 'Fatura', procedure: { name: 'Financeiro', prompt: 'Escolha um procedimento.' } };
  it('does not substitute an environment override or fallback model for a fixed release', async () => {
    await expect(generateProcedureRuntimeOutput({ ...input, fixedModel: true })).resolves.toEqual({ decision: 'invoice' });
    expect(mocks.run.mock.calls[0][0].modelCandidates).toEqual(['published-model']);
    expect(mocks.prompt.mock.calls[0][1]).toEqual({ model: 'published-model' });
  });
  it('preserves the legacy fallback policy for callers that have not opted into a fixed release', async () => {
    await generateProcedureRuntimeOutput(input);
    expect(mocks.run.mock.calls[0][0].modelCandidates[0]).toBe('environment-override');
    expect(mocks.run.mock.calls[0][0].modelCandidates).toContain('published-model');
    expect(mocks.run.mock.calls[0][0].modelCandidates.length).toBeGreaterThan(1);
  });
});
