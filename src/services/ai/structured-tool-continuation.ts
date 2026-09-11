/** Per-turn provider protocol state. Never checkpoint or log this object. */
export function createStructuredToolContinuation() {
  const messages: Record<string, unknown>[] = [];
  let pending: string | null = null;
  return {
    messages(system: string, context: string) {
      if (!messages.length) messages.push({ role: 'system', content: system }, { role: 'user', content: context });
      else if (pending) {
        messages.push({ role: 'tool', tool_call_id: pending, content: context });
        pending = null;
      } else messages.push({ role: 'user', content: context });
      return [...messages];
    },
    accept(message: unknown, name: string): string {
      const value = message as { content?: unknown; reasoning_content?: unknown; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
      const calls = value?.tool_calls;
      if (!calls?.length && typeof value?.content === 'string' && value.content.trim()) {
        // With automatic tool choice, the provider may submit the final structured decision
        // as content. The caller still validates the full schema before applying anything.
        messages.push({ role: 'assistant', content: value.content,
          reasoning_content: typeof value.reasoning_content === 'string' ? value.reasoning_content : '' });
        return value.content;
      }
      if (!calls || calls.length !== 1 || calls[0].type !== 'function' || calls[0].function.name !== name
        || typeof calls[0].id !== 'string' || typeof calls[0].function.arguments !== 'string') {
        throw Object.assign(new Error('O modelo precisa enviar uma única decisão pela ferramenta publicada.'), { code: 'INVALID_STRUCTURED_OUTPUT', retryable: true });
      }
      // DeepSeek requires the opaque reasoning field on subsequent tool requests. Keep it
      // only inside this closure; callers receive operational arguments, never this field.
      messages.push({ role: 'assistant', content: typeof value.content === 'string' ? value.content : '',
        reasoning_content: typeof value.reasoning_content === 'string' ? value.reasoning_content : '', tool_calls: calls });
      pending = calls[0].id;
      return calls[0].function.arguments;
    },
  };
}
export type StructuredToolContinuation = ReturnType<typeof createStructuredToolContinuation>;
