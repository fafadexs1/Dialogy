import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';
// @ts-ignore
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore
import ffprobePath from 'ffprobe-static';

// Configure FFmpeg path
const platform = os.platform();
let customFfmpegPath = process.env.FFMPEG_PATH;
let customFfprobePath = process.env.FFPROBE_PATH;

// Robustness: Ignore Windows paths if running on Linux (Docker)
// This prevents Docker containers from breaking if .env contains "C:/..."
if (platform !== 'win32') {
    if (customFfmpegPath && (customFfmpegPath.includes(':') || customFfmpegPath.includes('\\'))) {
        console.warn('[FFMPEG] Detected Windows path configuration in non-Windows environment. Falling back to default.');
        customFfmpegPath = undefined;
    }
    if (customFfprobePath && (customFfprobePath.includes(':') || customFfprobePath.includes('\\'))) {
        customFfprobePath = undefined;
    }
}

// Set FFMPEG Path
if (customFfmpegPath) {
    ffmpeg.setFfmpegPath(customFfmpegPath);
} else if (platform !== 'win32') {
    // Docker/Linux default fallback
    ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
} else if (ffmpegPath) {
    // @ts-ignore
    ffmpeg.setFfmpegPath(ffmpegPath);
}

// Set FFPROBE Path
if (customFfprobePath) {
    ffmpeg.setFfprobePath(customFfprobePath);
} else if (platform !== 'win32') {
    // Docker/Linux default fallback
    ffmpeg.setFfprobePath('/usr/bin/ffprobe');
} else if (ffprobePath && ffprobePath.path) {
    ffmpeg.setFfprobePath(ffprobePath.path);
}

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
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
]);

/**
 * Converts audio from WebM to OGG+Opus format for WhatsApp compatibility.
 * Can be called directly from Server Actions or API Routes.
 */
export async function convertAudioFile(
    audioUrl: string,
    workspaceId: string,
    allowedHosts: readonly string[],
): Promise<ConversionResult> {
    const startTime = Date.now();

    try {
        if (!audioUrl) {
            throw new Error('audioUrl is required');
        }



        console.log(`[AUDIO_CONVERT_SERVICE] Starting conversion for: ${audioUrl}`);

        // 1. Download the audio file
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
        console.log(`[AUDIO_CONVERT_SERVICE] Downloaded audio file, size: ${audioBuffer.length} bytes`);

        // 2. Create temp files for input and output
        const tempDir = os.tmpdir();
        const inputId = randomUUID();
        const outputId = randomUUID();
        const inputPath = path.join(tempDir, `input_${inputId}.webm`);
        const outputPath = path.join(tempDir, `output_${outputId}.ogg`);

        try {
            // Write input file
            await fs.writeFile(inputPath, audioBuffer);

            // 3. Convert using FFmpeg
            await new Promise<void>((resolve, reject) => {
                const command = ffmpeg(inputPath)
                    .audioCodec('libopus')
                    .audioChannels(1)
                    .audioBitrate('48k')
                    .audioFrequency(48000)
                    .format('ogg')
                    .on('end', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                const timeout = setTimeout(() => {
                    command.kill('SIGKILL');
                    reject(new Error('Audio conversion timed out.'));
                }, FFMPEG_TIMEOUT_MS);
                command.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }).save(outputPath);
            });

            // 4. Read converted file
            const convertedBuffer = await fs.readFile(outputPath);

            // 5. Upload to Supabase storage
            const supabase = await createClient();
            const bucket = process.env.AUDIO_OUTPUT_BUCKET || 'temp-media';
            const convertedFileName = `workspaces/${workspaceId}/converted/${randomUUID()}.ogg`;

            const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(convertedFileName, convertedBuffer, {
                    contentType: 'audio/ogg',
                    upsert: false
                });

            if (uploadError) {
                throw new Error(`Failed to upload converted audio: ${uploadError.message}`);
            }

            // 6. Return an expiring URL; the output bucket remains private.
            const { data: signedUrlData, error: signedUrlError } = await supabase.storage
                .from(bucket)
                .createSignedUrl(convertedFileName, 300);

            if (signedUrlError || !signedUrlData?.signedUrl) {
                throw new Error(`Failed to sign converted audio: ${signedUrlError?.message || 'unknown error'}`);
            }

            const convertedUrl = signedUrlData.signedUrl;
            console.log(`[AUDIO_CONVERT_SERVICE] Success: ${convertedUrl}`);

            return {
                success: true,
                convertedUrl,
                originalUrl: audioUrl,
                duration: Date.now() - startTime
            };

        } finally {
            // 7. Cleanup temp files
            await fs.unlink(inputPath).catch(() => { });
            await fs.unlink(outputPath).catch(() => { });
        }

    } catch (error: any) {
        console.error(`[AUDIO_CONVERT_SERVICE] Error:`, error);
        return {
            success: false,
            error: error.message || 'Conversion failed'
        };
    }
}
