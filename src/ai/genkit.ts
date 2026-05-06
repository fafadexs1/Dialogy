import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';

export const ai = genkit({
  plugins: [googleAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY || 'no-key-configured'
  })],
  model: DEFAULT_AUTOPILOT_MODEL,
});
