import { config } from 'dotenv';
config();

import '@/ai/flows/chat-summarization.ts';
import '@/ai/flows/case-memory-summarization.ts';
import '@/ai/flows/smart-replies.ts';
import '@/ai/flows/auto-responder.ts';
import '@/ai/flows/procedure-runtime.ts';
import '@/ai/flows/transcribe-audio.ts';
