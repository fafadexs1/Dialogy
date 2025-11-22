
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    audio: string; // Base64 without data URI prefix
}

/**
 * Sends a recorded audio message as a native WhatsApp voice note.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The audio payload containing the recipient number and base64 audio string.
 * @returns The response from the Evolution API.
 */
export async function sendAudioMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: AudioPayload
) {
     // The base64 data is already prepared by the calling function.
     const apiPayload = {
        number: payload.number,
        audio: payload.audio,
    };

    return await fetchEvolutionAPI(
        `/message/sendWhatsAppAudio/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(apiPayload),
        }
    );
}
