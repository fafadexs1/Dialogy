
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    audio: string; // Base64 with data URI prefix
}

/**
 * Sends an audio message using the Evolution API.
 * This specific endpoint is used to send audio as a voice message.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The audio payload.
 * @returns The response from the Evolution API.
 */
export async function sendAudioMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: AudioPayload
) {
     const apiPayload = {
        number: payload.number,
        options: {
            delay: 1200,
            presence: 'recording' // Shows "recording..." status in WhatsApp
        },
        audioMessage: {
            audio: payload.audio,
        }
    };

    // Note: The endpoint for sending as a recorded voice message is sendWhatsAppAudio
    return await fetchEvolutionAPI(
        `/message/sendWhatsAppAudio/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(apiPayload),
        }
    );
}
