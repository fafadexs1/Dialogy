'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    audio: string; // Base64 without data URI prefix or URL
    mimetype?: string;
    fileName?: string;
}

/**
 * Sends a recorded audio message as a native WhatsApp voice note.
 * Sends the audio URL directly to the Evolution API without conversion.
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
    const audioUrl = payload.audio;

    // Use /message/sendWhatsAppAudio endpoint - only requires number and audio
    // Evolution API often prefers pure numbers for this endpoint
    const formattedNumber = payload.number.replace('@s.whatsapp.net', '');

    const apiPayload = {
        number: formattedNumber,
        audio: audioUrl,
    };

    try {
        const response = await fetchEvolutionAPI(
            `/message/sendWhatsAppAudio/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify(apiPayload),
            }
        );
        return response;
    } catch (error: any) {
        console.error(`[SEND_AUDIO_ERROR] Error sending audio:`, error);
        if (error?.response?.data) {
            console.error(`[SEND_AUDIO_ERROR] API Error Data:`, JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}
