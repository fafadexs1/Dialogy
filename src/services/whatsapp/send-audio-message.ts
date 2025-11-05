
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    audio: string; // Base64 encoded audio with data URI prefix
}

/**
 * Sends an audio message as a voice note using the Evolution API.
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
    return await fetchEvolutionAPI(
        `/message/sendWhatsAppAudio/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(payload),
        }
    );
}
