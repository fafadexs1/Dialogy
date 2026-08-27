import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';
import { runFfmpeg } from '@/services/media/ffmpeg';

export interface ConversionResult {
  success: boolean;
  convertedUrl?: string;
  originalUrl?: string;
  duration?: number;
  error?: string;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
]);

/** Converts audio from WebM to OGG+Opus format for WhatsApp compatibility. */
export async function convertAudioFile(
  audioUrl: string,
  workspaceId: string,
  allowedHosts: readonly string[],
): Promise<ConversionResult> {
  const startTime = Date.now();

  try {
    if (!audioUrl) throw new Error('audioUrl is required');

    const audioResponse = await fetchSafeRemote(audioUrl, { cache: 'no-store' }, {
      allowedHosts,
      timeoutMs: 10_000,
      maxRedirects: 2,
    });
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
    }

    const contentType = (audioResponse.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!ALLOWED_AUDIO_TYPES.has(contentType)) throw new Error('Unsupported audio MIME type.');
    const audioBuffer = Buffer.from(await readResponseBodyLimited(audioResponse, MAX_AUDIO_BYTES));

    const tempDir = os.tmpdir();
    const inputId = randomUUID();
    const outputId = randomUUID();
    const inputPath = path.join(tempDir, `input_${inputId}.webm`);
    const outputPath = path.join(tempDir, `output_${outputId}.ogg`);

    try {
      await fs.writeFile(inputPath, audioBuffer);
      await runFfmpeg({
        inputPath,
        outputPath,
        args: ['-vn', '-c:a', 'libopus', '-ac', '1', '-b:a', '48k', '-ar', '48000', '-f', 'ogg'],
        timeoutMs: FFMPEG_TIMEOUT_MS,
      });

      const convertedBuffer = await fs.readFile(outputPath);
      const supabase = await createClient();
      const bucket = process.env.AUDIO_OUTPUT_BUCKET || 'temp-media';
      const convertedFileName = `workspaces/${workspaceId}/converted/${randomUUID()}.ogg`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(convertedFileName, convertedBuffer, {
          contentType: 'audio/ogg',
          upsert: false,
        });
      if (uploadError) throw new Error(`Failed to upload converted audio: ${uploadError.message}`);

      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(convertedFileName, 300);
      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error(`Failed to sign converted audio: ${signedUrlError?.message || 'unknown error'}`);
      }

      return {
        success: true,
        convertedUrl: signedUrlData.signedUrl,
        originalUrl: audioUrl,
        duration: Date.now() - startTime,
      };
    } finally {
      await fs.unlink(inputPath).catch(() => undefined);
      await fs.unlink(outputPath).catch(() => undefined);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[AUDIO_CONVERT_SERVICE] Error:', error);
    return { success: false, error: message || 'Conversion failed' };
  }
}
