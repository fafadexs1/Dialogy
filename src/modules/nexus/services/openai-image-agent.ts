import 'server-only';
import { platformApiKey } from '@/services/ai/platform-config';
import { meteredAiCall } from '@/services/ai/metered-call';

/** Uses only an explicitly configured and enabled image model, with platform credit reservation. */
export async function generateOpenAiAgentImage(input: { workspaceId: string; prompt: string; image?: { mimeType: string; data: Buffer }; signal: AbortSignal }): Promise<{ version: 1; mimeType: 'image/png'; dataBase64: string }> {
  const model = process.env.DIALOGY_AGENT_OPENAI_IMAGE_MODEL || '';
  if (!/^openai\/gpt-image-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Configure um modelo GPT Image autorizado na IA Global.');
  const apiKey = await platformApiKey(model);
  return meteredAiCall({ workspaceId: input.workspaceId, model, source: 'agent_image_generation', inputTokenBudget: 16384, outputTokenBudget: 8192, independent: true,
    execute: async (recordUsage) => {
      input.signal.throwIfAborted();
      const { default: OpenAI, toFile } = await import('openai');
      const client = new OpenAI({ apiKey, timeout: 90000, maxRetries: 0 });
      const options = { signal: input.signal };
      const common = { model: model.slice('openai/'.length), prompt: input.prompt, n: 1, size: '1024x1024' as const, quality: 'low' as const, output_format: 'png' as const };
      const response = input.image
        ? await client.images.edit({ ...common, image: await toFile(input.image.data, 'source', { type: input.image.mimeType }) }, options)
        : await client.images.generate(common, options);
      if (response.usage) await recordUsage({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      const dataBase64 = response.data?.[0]?.b64_json;
      if (!dataBase64) throw new Error('O provedor não retornou uma imagem.');
      return { version: 1, mimeType: 'image/png', dataBase64 };
    },
  });
}
