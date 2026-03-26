'use server';

/**
 * @fileOverview This file implements the audio transcription flow.
 *
 * - transcribeAudio - A function that transcribes an audio file URL.
 * - TranscribeAudioInput - The input type for the transcribeAudio function.
 * - TranscribeAudioOutput - The return type for the transcribeAudio function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getWorkspaceAiRuntimeConfig } from '@/actions/autopilot';

const TranscribeAudioInputSchema = z.object({
  audioUrl: z.string().url().describe('The public URL of the audio file to transcribe.'),
  workspaceId: z.string().describe('The workspace ID used to resolve Gemini configuration.'),
});

export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>;

const TranscribeAudioOutputSchema = z.object({
  transcription: z.string().describe('The transcribed text from the audio.'),
});

export type TranscribeAudioOutput = z.infer<typeof TranscribeAudioOutputSchema>;

export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput> {
  return transcribeAudioFlow(input);
}

const transcribeAudioFlow = ai.defineFlow(
  {
    name: 'transcribeAudioFlow',
    inputSchema: TranscribeAudioInputSchema,
    outputSchema: TranscribeAudioOutputSchema,
  },
  async (input) => {
    // Resolve AI runtime config without depending on a visible Autopilot agent.
    const runtimeConfig = await getWorkspaceAiRuntimeConfig(input.workspaceId);

    if (runtimeConfig.error) {
      throw new Error(runtimeConfig.error);
    }

    const apiKey = runtimeConfig.apiKey;

    if (!apiKey) {
      throw new Error('Integracao Gemini do workspace nao configurada ou inativa. Acesse Integracoes > Gemini.');
    }

    const modelName = runtimeConfig.transcriptionModel || runtimeConfig.aiModel || 'gemini-2.0-flash-exp';

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    try {
      const response = await fetch(input.audioUrl);
      if (!response.ok) {
        throw new Error(`Falha ao baixar audio: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = response.headers.get('content-type') || 'audio/mp3';

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: base64Audio,
          },
        },
        {
          text: 'Transcreva este audio para Portugues do Brasil (PT-BR). Retorne somente o texto da transcricao. Se o audio estiver em outro idioma, traduza para o Portugues.',
        },
      ]);

      return { transcription: result.response.text() };
    } catch (err: any) {
      console.error('[TRANSCRIBE_AUDIO] Error:', err);
      throw new Error(`Erro na transcricao: ${err.message}`);
    }
  }
);
