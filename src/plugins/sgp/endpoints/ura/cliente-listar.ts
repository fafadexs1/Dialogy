import { db } from '@/lib/db';
import type { SGPContactPanelData } from '../../types';

import {
    createSGPJsonRequestInit,
    getSGPActiveWorkspaceContext,
    isSGPContextError,
    withSGPApplicationCredentials,
} from '../../runtime';
import {
    buildSGPContactPanelData,
    getContractId,
    getPrimaryService,
    normalizeText,
} from '../../contact-panel-data';

type SGPContractOption = {
    id: string;
    label: string;
};

type SGPClientLookupContext = {
    workspaceId: string;
    global: any;
    sgpUser: any;
    cpf: string;
};

type SGPClientLookupResult =
    | { success: true; clientes: any[] }
    | { success: false; error: string };

type SGPSupportContractLookupResult =
    | { success: true; contracts: any[] }
    | { success: false; error: string };

async function resolveSGPClientLookupContext(chatId: string): Promise<
    | { success: true; data: SGPClientLookupContext }
    | { success: false; error: string }
> {
    const context = await getSGPActiveWorkspaceContext();
    if (isSGPContextError(context)) {
        return { success: false, error: context.error };
    }

    const { workspaceId, global, sgpUser, isGlobalReady } = context;
    if (!isGlobalReady || !global?.baseUrl || !global?.cpfFieldId) {
        return { success: false, error: 'Integracao SGP nao configurada globalmente.' };
    }

    if (!sgpUser?.token || !sgpUser.username) {
        return { success: false, error: 'Credenciais SGP do usuario nao configuradas.' };
    }

    const chatRes = await db.query(
        'SELECT contact_id FROM chats WHERE id = $1 AND workspace_id = $2',
        [chatId, workspaceId]
    );
    if (chatRes.rowCount === 0) {
        return { success: false, error: 'Chat nao encontrado.' };
    }

    const contactId = chatRes.rows[0].contact_id;
    const customFieldRes = await db.query(
        `
        SELECT value
        FROM contact_custom_field_values
        WHERE contact_id = $1 AND field_id = $2
    `,
        [contactId, global.cpfFieldId]
    );

    if (customFieldRes.rowCount === 0) {
        return {
            success: false,
            error: `CPF nao encontrado (Nao ha valor para o campo ID: ${global.cpfFieldId}).`,
        };
    }

    const cpf = String(customFieldRes.rows[0].value ?? '').trim();
    if (!cpf) {
        return { success: false, error: 'CPF vazio no campo mapeado.' };
    }

    return {
        success: true,
        data: {
            workspaceId,
            global,
            sgpUser,
            cpf,
        },
    };
}

async function fetchSGPClientsByChatId(chatId: string): Promise<
    SGPClientLookupResult
> {
    const lookup = await resolveSGPClientLookupContext(chatId);
    if (!lookup.success) {
        return lookup;
    }

    return fetchSGPClientsByLookupContext(lookup.data);
}

function normalizeCpfCnpjDigits(value: string): string {
    return String(value ?? '').replace(/\D/g, '');
}

async function fetchSGPClientsByLookupContext({
    global,
    sgpUser,
    cpf,
}: SGPClientLookupContext): Promise<SGPClientLookupResult> {
    try {
        const response = await fetch(
            `${global.baseUrl}/api/ura/clientes/`,
            createSGPJsonRequestInit(
                sgpUser.token,
                withSGPApplicationCredentials(global, {
                    cpfcnpj: cpf,
                    exibir_conexao: 1,
                })
            )
        );

        if (!response.ok) {
            const text = await response.text();
            console.error('[SGP] Error fetching clients:', text);
            return { success: false, error: `Erro na API SGP: ${response.status} ${response.statusText}` };
        }

        const data = await response.json();
        if (!Array.isArray(data?.clientes) || data.clientes.length === 0) {
            return { success: false, error: 'Nenhum cliente encontrado no SGP para este CPF.' };
        }

        return {
            success: true,
            clientes: data.clientes,
        };
    } catch (error) {
        console.error('[SGP] Exception fetching clients:', error);
        return { success: false, error: 'Falha de conexao com SGP.' };
    }
}

async function fetchSGPSupportContractsByLookupContext({
    global,
    sgpUser,
    cpf,
}: SGPClientLookupContext, contractId?: string | null): Promise<SGPSupportContractLookupResult> {
    const normalizedContractId = normalizeCpfCnpjDigits(contractId ?? '');
    const payload = withSGPApplicationCredentials(
        global,
        normalizedContractId
            ? { contrato_id: normalizedContractId }
            : { cliente_cpfcnpj: normalizeCpfCnpjDigits(cpf) }
    );
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

    let lastError = 'Falha ao consultar contratos de suporte no SGP.';

    for (const requestInit of requestCandidates) {
        try {
            const response = await fetch(`${global.baseUrl}/api/suporte/contrato/list/`, requestInit);
            if (!response.ok) {
                const text = await response.text();
                lastError = `Erro na API SGP: ${response.status} ${response.statusText}`;
                console.error('[SGP] Error fetching support contracts:', text);
                continue;
            }

            const data = await response.json();
            const contracts = Array.isArray(data)
                ? data
                : Array.isArray(data?.contratos)
                    ? data.contratos
                    : Array.isArray(data?.dados)
                        ? data.dados
                        : null;

            if (contracts) {
                return { success: true, contracts };
            }

            lastError = 'Resposta inesperada ao consultar contratos de suporte no SGP.';
        } catch (error) {
            console.error('[SGP] Exception fetching support contracts:', error);
            lastError = 'Falha de conexao com SGP na consulta de suporte.';
        }
    }

    return { success: false, error: lastError };
}

export async function fetchSGPContractsImpl(chatId: string): Promise<{
    success: boolean;
    error?: string;
    contracts?: SGPContractOption[];
}> {
    const clientRes = await fetchSGPClientsByChatId(chatId);
    if (!clientRes.success) {
        return { success: false, error: clientRes.error };
    }

    const contracts = clientRes.clientes.flatMap((cliente: any) => cliente.contratos || []);
    if (contracts.length === 0) {
        return { success: false, error: 'Nenhum contrato encontrado.' };
    }

    return {
        success: true,
        contracts: contracts
            .map((contract: any) => {
                const contractId = getContractId(contract);
                const primaryService = getPrimaryService(contract);
                const address = primaryService?.endereco || contract?.endereco || {};
                const addressLabel = [normalizeText(address?.cidade), normalizeText(address?.bairro)]
                    .filter(Boolean)
                    .join(' - ');
                const planDescription = normalizeText(primaryService?.plano?.descricao) || 'Contrato';

                return {
                    id: contractId,
                    label: `${contractId} - ${planDescription}${addressLabel ? ` - ${addressLabel}` : ''}`,
                };
            })
            .filter((contract: SGPContractOption) => contract.id),
    };
}

export async function fetchSGPContactPanelDataImpl(chatId: string, contractId?: string | null): Promise<{
    success: boolean;
    error?: string;
    data?: SGPContactPanelData;
}> {
    const normalizedContractId = String(contractId ?? '').trim();
    if (normalizedContractId && !/^\d+$/.test(normalizedContractId)) {
        return { success: false, error: 'contractId deve conter somente digitos.' };
    }

    const lookup = await resolveSGPClientLookupContext(chatId);
    if (!lookup.success) {
        return { success: false, error: lookup.error };
    }

    const [clientRes, supportRes] = await Promise.all([
        fetchSGPClientsByLookupContext(lookup.data),
        fetchSGPSupportContractsByLookupContext(lookup.data, normalizedContractId),
    ]);
    if (!clientRes.success) {
        return { success: false, error: clientRes.error };
    }

    if (!supportRes.success) {
        console.warn('[SGP] Support contract list unavailable for contact panel:', supportRes.error);
    }

    const data = buildSGPContactPanelData(
        clientRes.clientes,
        supportRes.success ? supportRes.contracts : []
    );
    if (!data) {
        return { success: false, error: 'Nenhum dado SGP encontrado para este cliente.' };
    }

    return {
        success: true,
        data,
    };
}
