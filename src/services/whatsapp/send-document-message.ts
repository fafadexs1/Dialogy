
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

interface DocumentPayload {
    number: string;
    media: string;
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
    const apiPayload = {
        number: payload.number,
        mediatype: 'document',
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
