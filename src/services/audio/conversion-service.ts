import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';

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

        // Configure FFmpeg path if environment variable is set (Docker)
        if (process.env.FFMPEG_PATH) {
            ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
        }
        if (process.env.FFPROBE_PATH) {
            ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
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
