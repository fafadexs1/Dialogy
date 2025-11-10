
'use server';

/**
 * @fileOverview This file implements the audio transcription flow.
 *
 * - transcribeAudio - A function that transcribes an audio file URL.
 * - TranscribeAudioInput - The input type for the transcribeAudio function.
 * - TranscribeAudioOutput - The return type for the transcribeAudio function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TranscribeAudioInputSchema = z.object({
  audioUrl: z.string().url().describe('The public URL of the audio file to transcribe.'),
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
    
    // Using a model that supports audio transcription.
    // The model will automatically fetch and process the audio from the URL.
    const result = await ai.generate({
        model: 'googleai/gemini-2.5-flash',
        prompt: [{ media: { url: input.audioUrl } }, {text: 'Transcribe this audio.'}]
    });
    
    const transcription = result.text;

    return { transcription };
  }
);
