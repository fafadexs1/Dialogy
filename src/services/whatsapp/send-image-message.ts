
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";
import { uploadTempMedia } from "./upload-temp-media";

interface ImagePayload {
    number: string;
    media: string; // Base64 (com ou sem prefixo) ou URL remota
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
    const { publicUrl } = await uploadTempMedia({
        media: payload.media,
        mimetype: payload.mimetype,
        fileName: payload.filename,
    });

    const apiPayload = {
        number: payload.number,
        mediatype: 'image',
        mimetype: payload.mimetype,
        media: publicUrl,
        caption: payload.caption,
        fileName: payload.filename,
    };
    
    const response = await fetchEvolutionAPI(
        `/message/sendMedia/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(apiPayload),
        }
    );

    return { ...response, tempMediaPublicUrl: publicUrl };
}
