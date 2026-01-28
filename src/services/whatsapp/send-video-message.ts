
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";
import { uploadTempMedia } from "./upload-temp-media";

interface VideoPayload {
    number: string;
    media: string; // Base64 (com ou sem prefixo) ou URL remota
    mimetype: string;
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
    let mediaUrl = payload.media;

    // Se não for URL (assumindo base64), faz upload para gerar link
    if (!payload.media.startsWith('http')) {
        const result = await uploadTempMedia({
            media: payload.media,
            mimetype: payload.mimetype,
            fileName: payload.filename,
        });
        mediaUrl = result.publicUrl;
    }

    const apiPayload = {
        number: payload.number,
        mediatype: 'video',
        mimetype: payload.mimetype,
        media: mediaUrl,
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

    return { ...response, tempMediaPublicUrl: mediaUrl };
}
