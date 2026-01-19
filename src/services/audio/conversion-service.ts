import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
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

/**
 * Converts audio from WebM to OGG+Opus format for WhatsApp compatibility.
 * Can be called directly from Server Actions or API Routes.
 */
export async function convertAudioFile(audioUrl: string, bucket: string = 'temp-media'): Promise<ConversionResult> {
    const startTime = Date.now();

    try {
        if (!audioUrl) {
            throw new Error('audioUrl is required');
        }



        console.log(`[AUDIO_CONVERT_SERVICE] Starting conversion for: ${audioUrl}`);

        // 1. Download the audio file
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
        }

        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
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
                ffmpeg(inputPath)
                    .audioCodec('libopus')
                    .audioChannels(1)
                    .audioBitrate('48k')
                    .audioFrequency(48000)
                    .format('ogg')
                    .on('error', (err) => reject(err))
                    .on('end', () => resolve())
                    .save(outputPath);
            });

            // 4. Read converted file
            const convertedBuffer = await fs.readFile(outputPath);

            // 5. Upload to Supabase storage
            const supabase = await createClient();
            const convertedFileName = `audio_converted_${Date.now()}.ogg`;

            const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(convertedFileName, convertedBuffer, {
                    contentType: 'audio/ogg',
                    upsert: true
                });

            if (uploadError) {
                throw new Error(`Failed to upload converted audio: ${uploadError.message}`);
            }

            // 6. Get public URL
            const { data: publicUrlData } = supabase.storage
                .from(bucket)
                .getPublicUrl(convertedFileName);

            const convertedUrl = publicUrlData.publicUrl;
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
