'use server';

import { getTeams } from '@/actions/teams';

import {
    getCRMFieldsImpl,
    getSGPConfigImpl,
    saveSGPGlobalConfigImpl,
    saveSGPUserConfigImpl,
} from './config';
import { createSGPServiceOrderImpl } from './endpoints/ura/chamado-criar';
import {
    fetchSGPContactPanelDataImpl,
    fetchSGPContractsImpl,
} from './endpoints/ura/cliente-listar';
import { generateSGPInvoicePixImpl } from './endpoints/ura/fatura-gerar-pix';
import { createSGPPaymentPromiseImpl } from './endpoints/ura/liberacao-promessa';

export { getTeams };

export async function saveSGPGlobalConfig(
    workspaceId: string,
    data: {
        baseUrl: string;
        cpfFieldId: string;
        appId: string;
        appToken: string;
        teamSectors: Record<string, string>;
    }
) {
    return saveSGPGlobalConfigImpl(workspaceId, data);
}

export async function saveSGPUserConfig(
    workspaceId: string,
    data: { username: string; password?: string }
) {
    return saveSGPUserConfigImpl(workspaceId, data);
}

export async function getSGPConfig(workspaceId: string) {
    return getSGPConfigImpl(workspaceId);
}

export async function getCRMFields(workspaceId: string) {
    return getCRMFieldsImpl(workspaceId);
}

export async function fetchSGPContracts(chatId: string) {
    return fetchSGPContractsImpl(chatId);
}

export async function fetchSGPContactPanelData(chatId: string) {
    return fetchSGPContactPanelDataImpl(chatId);
}

export async function createSGPServiceOrder(chatId: string, contractId: string, notes: string) {
    return createSGPServiceOrderImpl(chatId, contractId, notes);
}

export async function createSGPPaymentPromise(
    chatId: string,
    contractId: string,
    promiseDate: string,
    sendSms: boolean = true
) {
    return createSGPPaymentPromiseImpl(chatId, contractId, promiseDate, sendSms);
}

export async function generateSGPInvoicePix(invoiceId: string, contractId: string) {
    return generateSGPInvoicePixImpl(invoiceId, contractId);
}
