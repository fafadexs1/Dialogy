
'use server';

import { fetchEvolutionAPI } from "@/lib/whatsapp/evolution-api-client";
import type { EvolutionApiConfig } from "@/lib/types";

import { uploadTempMedia } from "./upload-temp-media";

interface DocumentPayload {
    number: string;
    media: string; // Base64 (com ou sem prefixo) ou URL remota
    mimetype: string;
    caption?: string;
    filename?: string;
}

/**
 * Sends a document message using the Evolution API.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param payload - The document payload.
 * @returns The response from the Evolution API.
 */
export async function sendDocumentMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: DocumentPayload
) {
    const uploaded = await uploadTempMedia({
        media: payload.media,
        mimetype: payload.mimetype,
        fileName: payload.filename,
    });
    const mediaUrl = uploaded.publicUrl;

    // URLs externas também passam pelo storage temporário. Isso preserva a
    // extensão do arquivo para adaptadores que inferem o MIME pela URL.

    const apiPayload = {
        number: payload.number,
        mediatype: 'document',
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
