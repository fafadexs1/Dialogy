
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface AudioPayload {
    number: string;
    media: string; // Base64 com data URI prefix
    mimetype: string;
    filename: string;
}

/**
 * Sends an audio file as a document using the Evolution API.
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
     const base64Data = payload.media.split(',')[1] || payload.media;

     const apiPayload = {
        number: payload.number,
        mediatype: 'document',
        mimetype: payload.mimetype,
        media: base64Data,
        fileName: payload.filename,
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
