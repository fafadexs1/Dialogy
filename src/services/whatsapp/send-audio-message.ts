
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    media: string; // Base64 with data URI prefix
    mimetype: string;
    filename?: string;
}

/**
 * Sends an audio message as a document using the Evolution API.
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
        mediatype: 'document',
        media: payload.media,
        mimetype: payload.mimetype,
        fileName: payload.filename || 'audio.ogg',
    };

    return await fetchEvolutionAPI(
        `/message/sendMedia/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(apiPayload),
        }
    );
}
