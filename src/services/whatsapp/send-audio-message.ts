
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    audio: string; // Base64 without data URI prefix or URL
    mimetype?: string;
    fileName?: string;
}

interface ConversionResponse {
    success: boolean;
    convertedUrl?: string;
    error?: string;
}

/**
 * Checks if the audio needs conversion (WebM format)
 */
function needsConversion(mimetype?: string, url?: string): boolean {
    if (mimetype?.includes('webm') || mimetype?.includes('video/')) {
        return true;
    }
    if (url?.endsWith('.webm')) {
        return true;
    }
    return false;
}

/**
 * Calls the audio conversion API to convert WebM to OGG+Opus
 */
async function convertAudio(audioUrl: string): Promise<ConversionResponse> {
    try {
        // Get the base URL from environment or use relative path
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:9002';

        console.log(`[AUDIO_CONVERT] Calling conversion API at ${baseUrl}/api/audio/convert`);

        const response = await fetch(`${baseUrl}/api/audio/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ audioUrl }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Conversion API returned ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        return result;
    } catch (error: any) {
        console.error(`[AUDIO_CONVERT] Conversion failed:`, error);
        return {
            success: false,
            error: error.message || 'Conversion failed'
        };
    }
}

/**
 * Sends a recorded audio message as a native WhatsApp voice note.
 * Automatically converts WebM to OGG+Opus if needed for WhatsApp Cloud API compatibility.
 * 
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The audio payload containing the recipient number, audio data, and optional metadata.
 * @returns The response from the Evolution API.
 */
export async function sendAudioMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: AudioPayload
) {
    let audioUrl = payload.audio;

    console.log(`[SEND_AUDIO_DEBUG] Original audio URL: ${audioUrl}`);
    console.log(`[SEND_AUDIO_DEBUG] Original mimetype: ${payload.mimetype}`);

    // Check if we need to convert the audio format
    if (needsConversion(payload.mimetype, audioUrl)) {
        console.log(`[SEND_AUDIO_DEBUG] Audio needs conversion (WebM detected)`);

        const conversionResult = await convertAudio(audioUrl);

        if (conversionResult.success && conversionResult.convertedUrl) {
            audioUrl = conversionResult.convertedUrl;
            console.log(`[SEND_AUDIO_DEBUG] Audio converted successfully: ${audioUrl}`);
        } else {
            console.warn(`[SEND_AUDIO_DEBUG] Conversion failed, using original: ${conversionResult.error}`);
            // Continue with original URL - it might still work
        }
    } else {
        console.log(`[SEND_AUDIO_DEBUG] Audio format OK, no conversion needed`);
    }

    // Use /message/sendWhatsAppAudio endpoint - only requires number and audio
    const apiPayload = {
        number: payload.number,
        audio: audioUrl,
    };

    console.log(`[SEND_AUDIO_DEBUG] Sending audio to ${instanceName}. Number: ${payload.number}`);
    console.log(`[SEND_AUDIO_DEBUG] Final audio URL: ${audioUrl}`);

    try {
        const response = await fetchEvolutionAPI(
            `/message/sendWhatsAppAudio/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify(apiPayload),
            }
        );
        console.log(`[SEND_AUDIO_DEBUG] Success response:`, response);
        return response;
    } catch (error: any) {
        console.error(`[SEND_AUDIO_DEBUG] Error sending audio:`, error);
        if (error?.response?.data) {
            console.error(`[SEND_AUDIO_DEBUG] API Error Data:`, JSON.stringify(error.response.data, null, 2));
        }
        if (error?.message) {
            console.error(`[SEND_AUDIO_DEBUG] Error Message:`, error.message);
        }
        throw error;
    }
}
