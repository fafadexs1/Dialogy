import { NextRequest, NextResponse } from 'next/server';
import { convertAudioFile } from '@/services/audio/conversion-service';

/**
 * POST /api/audio/convert
 * 
 * Wrapper around the conversion service for external access if needed.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { audioUrl, bucket = 'temp-media' } = body;

        const result = await convertAudioFile(audioUrl, bucket);

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

        return NextResponse.json(result);

    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Conversion failed'
            },
            { status: 500 }
        );
    }
}

