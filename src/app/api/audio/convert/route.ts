import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'stream';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

/**
 * POST /api/audio/convert
 * 
 * Converts audio from WebM to OGG+Opus format for WhatsApp compatibility.
 * 
 * Request body:
 * {
 *   audioUrl: string;     // URL of the audio file to convert (from Supabase storage)
 *   bucket?: string;      // Storage bucket name (default: 'temp-media')
 * }
 * 
 * Response:
 * {
 *   success: boolean;
 *   convertedUrl?: string;  // URL of the converted OGG file
 *   error?: string;
 * }
 */
export async function POST(request: NextRequest) {
    const startTime = Date.now();

    try {
        const body = await request.json();
        const { audioUrl, bucket = 'temp-media' } = body;

        if (!audioUrl) {
            return NextResponse.json(
                { success: false, error: 'audioUrl is required' },
                { status: 400 }
            );
        }

        console.log(`[AUDIO_CONVERT] Starting conversion for: ${audioUrl}`);

        // 1. Download the audio file
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
        }

        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        console.log(`[AUDIO_CONVERT] Downloaded audio file, size: ${audioBuffer.length} bytes`);

        // 2. Create temp files for input and output
        const tempDir = os.tmpdir();
        const inputId = randomUUID();
        const outputId = randomUUID();
        const inputPath = path.join(tempDir, `input_${inputId}.webm`);
        const outputPath = path.join(tempDir, `output_${outputId}.ogg`);

        // Write input file
        await fs.writeFile(inputPath, audioBuffer);
        console.log(`[AUDIO_CONVERT] Wrote input file: ${inputPath}`);

        // 3. Convert using FFmpeg
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .audioCodec('libopus')
                .audioChannels(1)
                .audioBitrate('48k')
                .audioFrequency(48000)
                .format('ogg')
                .on('start', (cmd) => {
                    console.log(`[AUDIO_CONVERT] FFmpeg command: ${cmd}`);
                })
                .on('progress', (progress) => {
                    console.log(`[AUDIO_CONVERT] Progress: ${JSON.stringify(progress)}`);
                })
                .on('error', (err) => {
                    console.error(`[AUDIO_CONVERT] FFmpeg error:`, err);
                    reject(err);
                })
                .on('end', () => {
                    console.log(`[AUDIO_CONVERT] Conversion completed`);
                    resolve();
                })
                .save(outputPath);
        });

        // 4. Read converted file
        const convertedBuffer = await fs.readFile(outputPath);
        console.log(`[AUDIO_CONVERT] Converted file size: ${convertedBuffer.length} bytes`);

        // 5. Upload to Supabase storage
        const supabase = await createClient();
        const convertedFileName = `audio_converted_${Date.now()}.ogg`;

        const { data: uploadData, error: uploadError } = await supabase.storage
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
        console.log(`[AUDIO_CONVERT] Uploaded converted file: ${convertedUrl}`);

        // 7. Cleanup temp files
        await fs.unlink(inputPath).catch(() => { });
        await fs.unlink(outputPath).catch(() => { });

        const duration = Date.now() - startTime;
        console.log(`[AUDIO_CONVERT] Total conversion time: ${duration}ms`);

        return NextResponse.json({
            success: true,
            convertedUrl,
            originalUrl: audioUrl,
            duration
        });

    } catch (error: any) {
        console.error(`[AUDIO_CONVERT] Error:`, error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Conversion failed'
            },
            { status: 500 }
        );
    }
}
