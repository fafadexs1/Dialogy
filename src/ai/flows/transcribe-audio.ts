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
import { getAutopilotConfig } from '@/actions/autopilot';

const TranscribeAudioInputSchema = z.object({
  audioUrl: z.string().url().describe('The public URL of the audio file to transcribe.'),
  workspaceId: z.string().describe('The ID of the workspace to fetch Gemini config from.'),
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
    // 1. Fetch Gemini Configuration for the Workspace
    const { config, error } = await getAutopilotConfig(input.workspaceId);

    if (error || !config) {
      throw new Error(error || 'Configuração do Gemini não encontrada para este workspace.');
    }

    const apiKey = config.gemini_api_key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('Chave de API do Gemini não configurada. Acesse Integrações > Gemini para configurar.');
    }
    const modelName = config.transcription_model || config.ai_model || 'gemini-2.0-flash-exp';

    // 2. Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    // 3. Fetch Audio Content
    try {
      const response = await fetch(input.audioUrl);
      if (!response.ok) {
        throw new Error(`Falha ao baixar áudio: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      // Determine mime type (simple check or default to audio/mp3 if unknown, 
      // though Gemini is flexible. Better to get from headers if possible)
      const mimeType = response.headers.get('content-type') || 'audio/mp3';

      // 4. Generate Content
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Audio
          }
        },
        { text: 'Transcribe this audio. Return ONLY the transcription text, nothing else.' }
      ]);

      const transcription = result.response.text();
      return { transcription };

    } catch (err: any) {
      console.error('[TRANSCRIBE_AUDIO] Error:', err);
      throw new Error(`Erro na transcrição: ${err.message}`);
    }
  }
);
