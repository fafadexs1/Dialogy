
'use server';

import { fetchEvolutionAPI } from "@/lib/whatsapp/evolution-api-client";
import type { EvolutionApiConfig } from "@/lib/types";
import { uploadTempMedia } from "./upload-temp-media";
import { normalizeVideoForWhatsApp } from './normalize-outbound-media';

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
    const normalized = await normalizeVideoForWhatsApp(payload.media, payload.mimetype, payload.filename);
    const uploaded = await uploadTempMedia({
        media: normalized.media,
        mimetype: normalized.mimetype,
        fileName: normalized.fileName,
    });
    const mediaUrl = uploaded.publicUrl;

    const apiPayload = {
        number: payload.number,
        mediatype: 'video',
        mimetype: normalized.mimetype,
        media: mediaUrl,
        caption: payload.caption,
        fileName: normalized.fileName,
    };

    const response = await fetchEvolutionAPI(
        `/message/sendMedia/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(apiPayload),
        }
    );

    return {
        ...response,
        tempMediaPublicUrl: mediaUrl,
        tempMediaMimetype: normalized.mimetype,
        tempMediaFileName: normalized.fileName,
    };
}
