'use server';

import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { preserveWhatsappRecipient } from '@/lib/whatsapp/bsuid';
import type { EvolutionApiConfig } from '@/lib/types';

// Arquivo "use server": só funções async podem ser exportadas, então os tipos
// ficam locais (mesmo padrão de send-list-message.ts).
type ButtonType = 'reply' | 'copy' | 'url' | 'call' | 'pix';

type ButtonPayload = {
    type: ButtonType;
    displayText?: string;
    id?: string;
    url?: string;
    copyCode?: string;
    phoneNumber?: string;
    currency?: string;
    name?: string;
    keyType?: 'phone' | 'email' | 'cpf' | 'cnpj' | 'random';
    key?: string;
};

type SendButtonsPayload = {
    number: string;
    thumbnailUrl?: string;
    title: string;
    description?: string;
    footer?: string;
    buttons: ButtonPayload[];
    delay?: number;
    quoted?: {
        key?: {
            id?: string;
        };
        message?: Record<string, unknown>;
    };
    mentionsEveryOne?: boolean;
    mentioned?: string[];
};

function normalizeRecipientNumber(value: string): string {
    const normalized = preserveWhatsappRecipient(value);
    return normalized || value;
}

export async function sendButtonsMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: SendButtonsPayload
) {
    return fetchEvolutionAPI(
        `/message/sendButtons/${instanceName}`,
        apiConfig,
        {
            method: 'POST',
            body: JSON.stringify({
                ...payload,
                number: normalizeRecipientNumber(payload.number),
            }),
        }
    );
}
