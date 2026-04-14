import { db } from '@/lib/db';
import type { SGPContactPanelContract, SGPContactPanelData, SGPContactPanelInvoice } from '../../types';

import {
    createSGPJsonRequestInit,
    getSGPActiveWorkspaceContext,
    isSGPContextError,
    withSGPApplicationCredentials,
} from '../../runtime';

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

function normalizeText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function toNumber(value: unknown): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function toDateValue(value: string | null | undefined): number {
    if (!value) {
        return Number.POSITIVE_INFINITY;
    }

    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function getContractId(rawContract: any): string {
    const contractId = rawContract?.contrato ?? rawContract?.id;
    return String(contractId ?? '').trim();
}

function getPrimaryService(rawContract: any) {
    return Array.isArray(rawContract?.servicos) ? rawContract.servicos[0] ?? null : null;
}

function buildAddressLabel(address: any): string {
    const line = [normalizeText(address?.logradouro), normalizeText(address?.numero)]
        .filter(Boolean)
        .join(', ');
    const neighborhood = normalizeText(address?.bairro);
    const city = [normalizeText(address?.cidade), normalizeText(address?.uf)]
        .filter(Boolean)
        .join(' - ');
    const complement = normalizeText(address?.complemento);

    return [line, neighborhood, city, complement]
        .filter(Boolean)
        .join(' • ');
}

function normalizeConnectionStatus(value: unknown): 'online' | 'offline' | 'unknown' {
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    if (!normalizedValue) {
        return 'unknown';
    }

    if (normalizedValue === 'online' || normalizedValue === 'on-line') {
        return 'online';
    }

    if (normalizedValue === 'offline' || normalizedValue === 'off-line') {
        return 'offline';
    }

    return 'unknown';
}

function buildContractDetails(rawContract: any): SGPContactPanelContract {
    const primaryService = getPrimaryService(rawContract);
    const connection = primaryService?.onu?.conexao ?? null;
    const connectionStatus = normalizeConnectionStatus(connection?.status);
    const ip = normalizeText(connection?.ip) || normalizeText(primaryService?.ip);
    const mac = normalizeText(primaryService?.mac);
    const login = normalizeText(primaryService?.login);
    const serial = normalizeText(primaryService?.onu?.serial);
    const detailParts = [
        ip ? `IP: ${ip}` : null,
        mac ? `MAC: ${mac}` : null,
        !ip && !mac && login ? `PPPoE: ${login}` : null,
        !ip && !mac && !login && serial ? `Serial: ${serial}` : null,
    ].filter(Boolean);
    const addressLabel =
        buildAddressLabel(primaryService?.endereco) ||
        buildAddressLabel(rawContract?.endereco) ||
        buildAddressLabel(rawContract?.cliente_endereco);

    return {
        id: getContractId(rawContract),
        planDescription:
            normalizeText(primaryService?.plano?.descricao) ||
            normalizeText(rawContract?.status) ||
            `Contrato ${getContractId(rawContract)}`,
        serviceType: normalizeText(primaryService?.tipo),
        connectionStatus,
        statusLabel:
            connectionStatus === 'online'
                ? 'Online'
                : connectionStatus === 'offline'
                    ? 'Offline'
                    : normalizeText(rawContract?.status) || 'Sem status',
        detailsLabel: detailParts.join(' • ') || 'Sem detalhes de conexao',
        addressLabel: addressLabel || 'Endereco nao informado',
        login,
        ip,
        mac,
        serial,
        connectedAt: normalizeText(connection?.data_conexao),
        disconnectedAt: normalizeText(connection?.data_desconexao),
        contractDate: normalizeText(rawContract?.dataCadastro),
        reason: normalizeText(rawContract?.motivo_status),
    };
}

function buildInvoiceDetails(rawInvoice: any): SGPContactPanelInvoice {
    const dueDate = normalizeText(rawInvoice?.dataVencimento);
    const paymentDate = normalizeText(rawInvoice?.dataPagamento);
    const cancellationDate = normalizeText(rawInvoice?.dataCancelamento);
    const status = String(rawInvoice?.status ?? '').trim().toLowerCase();
    const isOpenInvoice = status === 'aberto' || status === 'abertos';
    const dueTimestamp = dueDate ? new Date(`${dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
        id: String(rawInvoice?.id ?? '').trim(),
        contractId: String(rawInvoice?.clienteContrato ?? rawInvoice?.contrato ?? '').trim(),
        status: status || 'desconhecido',
        amount: toNumber(rawInvoice?.valor),
        correctedAmount: toNumber(rawInvoice?.valorCorrigido || rawInvoice?.valor),
        daysLate: toNumber(rawInvoice?.diasAtraso),
        dueDate,
        issueDate: normalizeText(rawInvoice?.dataEmissao),
        paymentDate,
        cancellationDate,
        barcode: normalizeText(rawInvoice?.codigoBarras),
        pixCode: normalizeText(rawInvoice?.codigoPix),
        isOverdue: isOpenInvoice && dueTimestamp < today.getTime(),
    };
}

export function buildSGPContactPanelData(clientes: any[]): SGPContactPanelData | null {
    if (!Array.isArray(clientes) || clientes.length === 0) {
        return null;
    }

    const customerName = normalizeText(clientes[0]?.nome) || 'Cliente';
    const cpfCnpj = normalizeText(clientes[0]?.cpfcnpj) || '';
    const contracts = clientes
        .flatMap((cliente) => (Array.isArray(cliente?.contratos) ? cliente.contratos : []))
        .map(buildContractDetails)
        .filter((contract) => contract.id);

    const invoiceMap = new Map<string, SGPContactPanelInvoice>();
    clientes
        .flatMap((cliente) => (Array.isArray(cliente?.titulos) ? cliente.titulos : []))
        .map(buildInvoiceDetails)
        .filter((invoice) => invoice.id)
        .forEach((invoice) => {
            invoiceMap.set(invoice.id, invoice);
        });

    const invoices = [...invoiceMap.values()].sort((left, right) => {
        if (left.isOverdue !== right.isOverdue) {
            return left.isOverdue ? -1 : 1;
        }

        return toDateValue(left.dueDate) - toDateValue(right.dueDate);
    });

    return {
        customerName,
        cpfCnpj,
        contracts,
        invoices,
        onlineContracts: contracts.filter((contract) => contract.connectionStatus === 'online').length,
        overdueInvoices: invoices.filter((invoice) => invoice.isOverdue).length,
        openInvoices: invoices.filter((invoice) => invoice.status === 'aberto' || invoice.status === 'abertos').length,
    };
}

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
    | { success: true; clientes: any[] }
    | { success: false; error: string }
> {
    const lookup = await resolveSGPClientLookupContext(chatId);
    if (!lookup.success) {
        return lookup;
    }

    const { global, sgpUser, cpf } = lookup.data;

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

export async function fetchSGPContactPanelDataImpl(chatId: string): Promise<{
    success: boolean;
    error?: string;
    data?: SGPContactPanelData;
}> {
    const clientRes = await fetchSGPClientsByChatId(chatId);
    if (!clientRes.success) {
        return { success: false, error: clientRes.error };
    }

    const data = buildSGPContactPanelData(clientRes.clientes);
    if (!data) {
        return { success: false, error: 'Nenhum dado SGP encontrado para este cliente.' };
    }

    return {
        success: true,
        data,
    };
}
