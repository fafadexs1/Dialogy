
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface VideoPayload {
    number: string;
    media: string;
    caption?: string;
    filename?: string;
}

/**
 * Sends a video message using the Evolution API.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The video payload.
 * @returns The response from the Evolution API.
 */
export async function sendVideoMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: VideoPayload
) {
    const apiPayload = {
        number: payload.number,
        mediatype: 'video',
        media: payload.media,
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
