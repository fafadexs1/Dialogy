import { z } from 'zod';
import sharp from 'sharp';
import { WorkflowFileReferenceSchema } from '@/services/workflow-runtime/file-reference';
import { requestPublicHttps } from './public-http';
import { loadWorkflowFile, saveWorkflowFile } from './workflow-files';
import { generateOpenAiAgentImage } from './openai-image-agent';
import { extractVideoFrames } from './video-frames';
import { analyzePlatformVideoFrames } from '@/services/ai/platform-video';

const referenceSchema = { type: 'object', properties: { kind: { type: 'string', enum: ['workflow_file'] }, id: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'integer' } }, required: ['kind', 'id', 'name', 'mimeType', 'size'], additionalProperties: false };
const definitions = {
  'tool.image': { name: 'generate_or_edit_image', description: 'Cria uma imagem ou edita uma imagem privada informada. A operação usa o serviço de mídia configurado e pode ter custo.', schema: z.object({ prompt: z.string().min(1).max(4000), reference: WorkflowFileReferenceSchema.optional() }).strict(), jsonSchema: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, reference: referenceSchema }, required: ['prompt'], additionalProperties: false } },
  'tool.image_analysis': { name: 'analyze_image', description: 'Analisa imagem privada informada, enviando-a ao serviço de mídia configurado.', schema: z.object({ prompt: z.string().min(1).max(4000), image: WorkflowFileReferenceSchema }).strict(), jsonSchema: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, image: referenceSchema }, required: ['prompt', 'image'], additionalProperties: false } },
  'tool.video_analysis': { name: 'analyze_video', description: 'Analisa um vídeo privado fornecido, enviando seu conteúdo ao serviço de mídia configurado.', schema: z.object({ prompt: z.string().min(1).max(4000), video: WorkflowFileReferenceSchema }).strict(), jsonSchema: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, video: referenceSchema }, required: ['prompt', 'video'], additionalProperties: false } },
} as const;
export const mediaAgentTools = definitions;

async function requestMediaService(payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const endpoint = process.env.DIALOGY_AGENT_MEDIA_ENDPOINT || '';
  const token = process.env.DIALOGY_AGENT_MEDIA_TOKEN || '';
  if (!endpoint || !token) throw new Error('Serviço de mídia não configurado.');
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('Endpoint de mídia inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || /[\r\n]/.test(token)) throw new Error('Configuração do serviço de mídia inválida.');
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 8_000_000) throw new Error('A mídia enviada excede o limite.');
  const response = await requestPublicHttps({ url: url.href, method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, timeoutMs: 90000, maxResponseBytes: 10_000_000, signal });
  if (!/^application\/json(?:\s*;|$)/i.test(String(response.headers['content-type'] || ''))) throw new Error('O serviço de mídia devolveu conteúdo incompatível.');
  try { return JSON.parse(response.body.toString('utf8')); } catch { throw new Error('O serviço de mídia devolveu JSON inválido.'); }
}

export async function executeMediaAgentTool(type: keyof typeof definitions, args: Record<string, unknown>, workspaceId: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  if (type === 'tool.image') {
    const { prompt, reference } = definitions[type].schema.parse(args);
    let source: { mimeType: string; dataBase64: string } | undefined;
    if (reference) {
      const { file, data } = await loadWorkflowFile(workspaceId, reference);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || data.length > 5_000_000) throw new Error('Use uma imagem PNG, JPEG ou WebP de até 5 MB.');
      source = { mimeType: file.mimeType, dataBase64: data.toString('base64') };
    }
    const response = process.env.DIALOGY_AGENT_IMAGE_PROVIDER === 'openai'
      ? await generateOpenAiAgentImage({ workspaceId, prompt, image: source ? { mimeType: source.mimeType, data: Buffer.from(source.dataBase64, 'base64') } : undefined, signal })
      : await requestMediaService({ version: 1, action: reference ? 'edit_image' : 'generate_image', prompt, ...(source ? { image: source } : {}), limits: { maxPixels: 16000000, maxBytes: 7000000 } }, signal);
    const parsed = z.object({ version: z.literal(1), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), dataBase64: z.string().min(1).max(9_400_000) }).parse(response);
    if (parsed.dataBase64.length % 4 || /[^A-Za-z0-9+/=]/.test(parsed.dataBase64)) throw new Error('A imagem devolvida não é base64 válido.');
    const data = Buffer.from(parsed.dataBase64, 'base64');
    if (data.toString('base64') !== parsed.dataBase64) throw new Error('A imagem devolvida não é base64 válido.');
    if (!data.length || data.length > 7_000_000) throw new Error('A imagem devolvida excede o limite.');
    const metadata = await sharp(data, { limitInputPixels: 16000000 }).metadata();
    const format = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>;
    if (!metadata.format || format[metadata.format] !== parsed.mimeType || !metadata.width || !metadata.height || metadata.width * metadata.height > 16000000) throw new Error('Imagem devolvida inválida ou com formato incompatível.');
    signal.throwIfAborted();
    const file = await saveWorkflowFile({ workspaceId, name: `imagem.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`, mimeType: parsed.mimeType, data });
    return { file, width: metadata.width, height: metadata.height };
  }
  const analysis = type === 'tool.image_analysis' ? definitions[type].schema.parse(args) : definitions[type].schema.parse(args);
  const reference = 'image' in analysis ? analysis.image : analysis.video;
  const { file, data } = await loadWorkflowFile(workspaceId, reference);
  const imageMode = type === 'tool.image_analysis';
  if (!(imageMode ? ['image/png', 'image/jpeg', 'image/webp'] : ['video/mp4', 'video/webm']).includes(file.mimeType) || data.length > 5_000_000) throw new Error(imageMode ? 'Use uma imagem PNG, JPEG ou WebP de até 5 MB.' : 'Use um vídeo MP4 ou WebM de até 5 MB.');
  if (!imageMode && process.env.DIALOGY_AGENT_VIDEO_IMAGE) {
    const extracted = await extractVideoFrames(data, signal);
    const text = await analyzePlatformVideoFrames({ workspaceId, prompt: analysis.prompt, frames: extracted.frames, coverage: extracted.coverage, estimatedDurationSeconds: extracted.estimatedDurationSeconds, sampleTimesSeconds: extracted.sampleTimesSeconds, signal });
    return { text, framesAnalyzed: extracted.frames.length, coverage: extracted.coverage, estimatedDurationSeconds: extracted.estimatedDurationSeconds, sampleTimesSeconds: extracted.sampleTimesSeconds, audioAnalyzed: false };
  }
  const response = await requestMediaService({ version: 1, action: imageMode ? 'analyze_image' : 'analyze_video', prompt: analysis.prompt, [imageMode ? 'image' : 'video']: { mimeType: file.mimeType, dataBase64: data.toString('base64') }, limits: { maxOutputCharacters: 16000 } }, signal);
  const parsed = z.object({ version: z.literal(1), text: z.string().min(1).max(16000) }).parse(response);
  const token = process.env.DIALOGY_AGENT_MEDIA_TOKEN || '';
  return { text: parsed.text.split(token).join('[protegido]') };
}
