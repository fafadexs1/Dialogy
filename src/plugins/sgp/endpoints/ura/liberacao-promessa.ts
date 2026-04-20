import { db } from '@/lib/db';

import type { SGPPaymentPromiseResponse } from '../../types';
import {
    createSGPJsonRequestInit,
    getSGPActiveWorkspaceContext,
    isSGPContextError,
    withSGPApplicationCredentials,
} from '../../runtime';

function isValidPromiseDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function createSGPPaymentPromiseImpl(
    chatId: string,
    contractId: string,
    promiseDate: string,
    sendSms: boolean = true
): Promise<{
    success: boolean;
    error?: string;
    apiResponse?: SGPPaymentPromiseResponse;
}> {
    const normalizedPromiseDate = String(promiseDate || '').trim();
    if (!isValidPromiseDate(normalizedPromiseDate)) {
        return { success: false, error: 'Data da promessa invalida. Use o formato yyyy-MM-dd.' };
    }

    const numericContractId = Number(String(contractId ?? '').replace(/\D/g, ''));
    if (!Number.isFinite(numericContractId) || numericContractId <= 0) {
        return { success: false, error: 'Contrato invalido para promessa de pagamento.' };
    }

    const context = await getSGPActiveWorkspaceContext();
    if (isSGPContextError(context)) {
        return { success: false, error: context.error };
    }

    const { workspaceId, global, sgpUser, isGlobalReady } = context;
    if (!isGlobalReady || !global?.baseUrl || !global?.appId || !global?.appToken) {
        return { success: false, error: 'Integracao SGP incompleta (verifique baseUrl, app e token).' };
    }

    const chatRes = await db.query(
        `
        SELECT 1
        FROM chats
        WHERE id = $1 AND workspace_id = $2
        LIMIT 1
    `,
        [chatId, workspaceId]
    );
    if (chatRes.rowCount === 0) {
        return { success: false, error: 'Chat nao encontrado para o workspace ativo.' };
    }

    const payload = withSGPApplicationCredentials(global, {
        contrato: numericContractId,
        data_promessa: normalizedPromiseDate,
        enviar_sms: sendSms ? 1 : 0,
    });
    const requestCandidates: RequestInit[] = [
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        },
    ];

    if (sgpUser?.token) {
        requestCandidates.push(
            createSGPJsonRequestInit(
                sgpUser.token,
                payload
            )
        );
    }

    let lastError = 'Falha ao registrar promessa de pagamento no SGP.';

    for (const requestInit of requestCandidates) {
        try {
            const response = await fetch(`${global.baseUrl}/api/ura/liberacaopromessa/`, requestInit);
            const text = await response.text();

            let data: SGPPaymentPromiseResponse | null = null;
            try {
                data = JSON.parse(text);
            } catch {
                data = text
                    ? {
                        status: response.ok ? 1 : response.status,
                        msg: text,
                        contratoId: numericContractId,
                    }
                    : null;
            }

            if (response.ok && data) {
                return { success: true, apiResponse: data };
            }

            const errorMessage =
                data?.msg ||
                text ||
                `${response.status} ${response.statusText}`;
            lastError = `SGP Erro: ${errorMessage}`;
            console.error('[SGP] Error creating payment promise:', errorMessage);
        } catch (error) {
            console.error('[SGP] Exception creating payment promise:', error);
            lastError = 'Erro de conexao ao registrar promessa de pagamento no SGP.';
        }
    }

    return { success: false, error: lastError };
}
