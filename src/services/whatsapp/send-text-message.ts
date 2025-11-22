
'use server';

import { fetchEvolutionAPI } from "@/actions/evolution-api";
import type { EvolutionApiConfig } from "@/lib/types";

/**
 * Sends a text message using the Evolution API.
 * @param apiConfig - The API configuration.
 * @param instanceName - The name of the Evolution API instance.
 * @param remoteJid - The recipient's JID.
 * @param text - The content of the message.
 * @returns The response from the Evolution API.
 */
export async function sendTextMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    remoteJid: string,
    text: string
) {
    const payload = {
        number: remoteJid,
        text: text,
    };
    
    return await fetchEvolutionAPI(
        `/message/sendText/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify(payload),
        }
    );
}
