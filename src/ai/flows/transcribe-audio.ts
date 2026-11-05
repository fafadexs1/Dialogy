import 'server-only';

/**
 * @fileOverview Audio transcription flow backed by the hosted Whisper API.
 *
 * - transcribeAudio - A function that transcribes an audio file URL.
 * - TranscribeAudioInput - The input type for the transcribeAudio function.
 * - TranscribeAudioOutput - The return type for the transcribeAudio function.
 */

import { ai } from '@/ai/genkit';
import { transcribeAudioUrlWithWhisper } from '@/services/audio/transcription-service';
import { z } from 'genkit';

const TranscribeAudioInputSchema = z.object({
  audioUrl: z.string().url().describe('The public URL of the audio file to transcribe.'),
  workspaceId: z.string().describe('The workspace ID associated with the audio transcription request.'),
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
    try {
      const transcription = await transcribeAudioUrlWithWhisper(input.audioUrl);
      return { transcription };
    } catch (err: any) {
      console.error('[TRANSCRIBE_AUDIO] Error:', err);
      throw new Error(`Erro na transcricao: ${err.message}`);
    }
  }
);
