
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface ImagePayload {
    number: string;
    media: string; // Base64 com data URI prefix
    mimetype: string;
    caption?: string;
    filename?: string;
}

/**
 * Sends an image message using the Evolution API.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The image payload.
 * @returns The response from the Evolution API.
 */
export async function sendImageMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: ImagePayload
) {
    const base64Data = payload.media.split(',')[1] || payload.media;

    const apiPayload = {
        number: payload.number,
        mediatype: 'image',
        mimetype: payload.mimetype,
        media: base64Data,
        caption: payload.caption,
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
