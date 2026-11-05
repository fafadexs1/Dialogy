import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { requestOpenAiCompatibleJson } from '@/services/ai/openai-compatible';
import { createStructuredToolContinuation } from '@/services/ai/structured-tool-continuation';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const payload = { schema: z.object({ ok: z.boolean() }), schemaName: 'reasoning_test',
  jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  apiKey: 'synthetic-provider-key', systemPrompt: 'Return the decision.', userPrompt: 'Test', maxTokens: 4096 };
function transport() {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}', reasoning_content: 'private internal reasoning' } }],
    usage: { prompt_tokens: 120, completion_tokens: 50, total_tokens: 170, completion_tokens_details: { reasoning_tokens: 40 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('reasoning requests through the real provider adapter and SDK, with controlled HTTP transport', () => {
  it('continues native tool reasoning within one turn without exposing it in the returned decision or another turn', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, reasoning_content: 'opaque-provider-state', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'reasoning_test', arguments: '{"ok":true}' } }],
    } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const continuation = createStructuredToolContinuation();
    const first = await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', continuation });
    await requestOpenAiCompatibleJson({ ...payload, userPrompt: 'Validated tool result', fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', continuation });
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.response_format).toBeUndefined();
    expect(body.tools[0].function.name).toBe('reasoning_test');
    expect(body.messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'opaque-provider-state' });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'Validated tool result' });
    expect(first).toEqual({ ok: true }); expect(JSON.stringify(continuation)).toBe('{}');
    await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', continuation: createStructuredToolContinuation() });
    expect(JSON.parse(fetch.mock.calls[2][1].body).messages).toHaveLength(2);
  });

  it('rejects multiple or invented native calls before any operational decision is returned', () => {
    const continuation = createStructuredToolContinuation();
    const call = { id: 'a', type: 'function', function: { name: 'wrong', arguments: '{}' } };
    expect(() => continuation.accept({ tool_calls: [call] }, 'expected')).toThrow('única decisão');
    expect(() => continuation.accept({ tool_calls: [call, call] }, 'wrong')).toThrow('única decisão');
  });

  it('validates direct structured content while retaining provider continuity under automatic tool choice', async () => {
    const fetch = transport(); const continuation = createStructuredToolContinuation();
    await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', continuation });
    await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', continuation, userPrompt: 'State after validation' });
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages[2]).toMatchObject({ role: 'assistant', content: '{"ok":true}', reasoning_content: 'private internal reasoning' });
    expect(body.messages[3]).toEqual({ role: 'user', content: 'State after validation' });
  });
  it('does not accept even valid JSON when the provider reports an exhausted output budget', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium' })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_TRUNCATED' });
  });
  it('enables DeepSeek thinking per request even when the global legacy switch is disabled', async () => {
    vi.stubEnv('AI_DEEPSEEK_THINKING', 'disabled');
    const fetch = transport(), usage = vi.fn();
    const result = await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', reasoning: 'medium', onUsage: usage });
    expect(result).toEqual({ ok: true });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'enabled' }); expect(body.reasoning_effort).toBe('high');
    expect(body.max_tokens).toBe(4096); expect(body.temperature).toBeUndefined();
    expect(usage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 50, totalTokens: 170, reasoningTokens: 40 });
    expect(JSON.stringify(result)).not.toContain('private internal reasoning');
  });
  it('uses the reasoning token budget parameter for OpenAI without sampling overrides', async () => {
    const fetch = transport();
    await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'openai/gpt-5.4-mini', reasoning: 'low' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(4096); expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe('low'); expect(body.temperature).toBeUndefined();
    expect(body.response_format.type).toBe('json_schema');
  });
  it('preserves behavior for existing non-reasoning callers', async () => {
    vi.stubEnv('AI_DEEPSEEK_THINKING', 'disabled'); const fetch = transport();
    await requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.thinking.type).toBe('disabled'); expect(body.reasoning_effort).toBeUndefined();
  });
  it('does not call the provider after the conversation has been aborted', async () => {
    const fetch = transport(); const controller = new AbortController(); controller.abort();
    await expect(requestOpenAiCompatibleJson({ ...payload, fetch, model: 'deepseek/deepseek-v4-flash', signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
