'use server';

import { getWorkspaceAiRuntimeConfig } from '@/actions/autopilot';
import { DEFAULT_AUTOPILOT_MODEL, getGoogleAiSdkModelName } from '@/lib/ai-models';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { transcribeAudio } from '@/ai/flows/transcribe-audio';

export type AnalyzeMediaInput = {
  mediaUrl: string;
  workspaceId: string;
  mediaType: 'audio' | 'image' | 'video' | 'document';
  mimetype?: string | null;
  caption?: string | null;
};

export type AnalyzeMediaOutput = {
  analysis: string;
};

function buildPrompt(input: AnalyzeMediaInput): string {
  const caption = input.caption?.trim()
    ? `\nLegenda/texto enviado pelo cliente: "${input.caption.trim()}".`
    : '';

  if (input.mediaType === 'image') {
    return `Analise esta imagem no contexto de atendimento ao cliente. Descreva objetivamente o que aparece, possiveis problemas visiveis e informacoes uteis para o atendente em ate 4 frases curtas.${caption}`;
  }

  if (input.mediaType === 'video') {
    return `Analise este video no contexto de atendimento ao cliente. Resuma o que aparece/acontece e qualquer problema visivel ou audivel em ate 4 frases curtas.${caption}`;
  }

  return `Analise este arquivo no contexto de atendimento ao cliente e resuma informacoes uteis em ate 4 frases curtas.${caption}`;
}

export async function analyzeMediaForAutopilot(input: AnalyzeMediaInput): Promise<AnalyzeMediaOutput> {
  if (input.mediaType === 'audio') {
    const result = await transcribeAudio({
      audioUrl: input.mediaUrl,
      workspaceId: input.workspaceId,
    });
    const caption = input.caption?.trim() ? ` Legenda/texto enviado pelo cliente: ${input.caption.trim()}` : '';
    return { analysis: `${result.transcription}${caption}`.trim() };
  }

  const runtimeConfig = await getWorkspaceAiRuntimeConfig(input.workspaceId);
  if (runtimeConfig.error) {
    throw new Error(runtimeConfig.error);
  }

  const apiKey = runtimeConfig.apiKey;
  if (!apiKey) {
    throw new Error('Integracao Gemini do workspace nao configurada ou inativa.');
  }

  const response = await fetch(input.mediaUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Media = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = input.mimetype || response.headers.get('content-type') || 'application/octet-stream';
  const modelName = getGoogleAiSdkModelName(runtimeConfig.aiModel) || getGoogleAiSdkModelName(DEFAULT_AUTOPILOT_MODEL)!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Media,
      },
    },
    { text: buildPrompt(input) },
  ]);

  return { analysis: result.response.text().trim() };
}
