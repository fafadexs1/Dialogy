'use server';

import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { EvolutionApiConfig } from '@/lib/types';

type ListRowPayload = {
    title: string;
    description?: string;
    rowId: string;
};

type ListSectionPayload = {
    title: string;
    rows: ListRowPayload[];
};

type SendListPayload = {
    number: string;
    title?: string;
    description?: string;
    buttonText: string;
    footerText?: string;
    sections: ListSectionPayload[];
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
    const normalized = value.replace(/@.*$/, '').replace(/\D/g, '');
    return normalized || value;
}

export async function sendListMessage(
    apiConfig: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    instanceName: string,
    payload: SendListPayload
) {
    return fetchEvolutionAPI(
        `/message/sendList/${instanceName}`,
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
