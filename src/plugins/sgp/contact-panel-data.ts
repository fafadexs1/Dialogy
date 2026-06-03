import type {
    SGPContactPanelContract,
    SGPContactPanelData,
    SGPContactPanelInvoice,
    SGPContactPanelInvoiceGroup,
    SGPContactPanelInvoiceSection,
    SGPContactPanelInvoiceSectionKey,
} from './types';
import { SGP_UNASSIGNED_INVOICE_GROUP_KEY } from './types';

type SGPSupportContractSnapshot = {
    id: string;
    planDescription: string | null;
    addressLabel: string | null;
    connectionStatus: SGPContactPanelContract['connectionStatus'];
    rawStatus: string | null;
    ip: string | null;
    ipv6: string | null;
    delegatedIpv6: string | null;
    cto: string | null;
    geoLocation: string | null;
    login: string | null;
    mac: string | null;
    connectedAt: string | null;
    contractDate: string | null;
};

function parseDateValue(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const normalizedValue = String(value).includes('T') ? String(value) : `${value}T00:00:00`;
    const timestamp = new Date(normalizedValue).getTime();

    return Number.isNaN(timestamp) ? null : timestamp;
}

function toNumber(value: unknown): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

export function normalizeText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function normalizeContractLookupKey(value: unknown): string | null {
    const text = String(value ?? '').trim();
    if (!text) {
        return null;
    }

    const digitsOnly = text.replace(/\D/g, '');
    return digitsOnly || text.toLowerCase();
}

function getInvoiceDisplayAmount(invoice: SGPContactPanelInvoice): number {
    return invoice.correctedAmount || invoice.amount;
}

function normalizeInvoiceStatus(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeStatusValue(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function getInvoiceSectionKey(invoice: SGPContactPanelInvoice): SGPContactPanelInvoiceSectionKey {
    if (invoice.isOverdue) {
        return 'overdue';
    }

    if (invoice.isOpen) {
        return 'open';
    }

    return 'history';
}

function compareInvoices(left: SGPContactPanelInvoice, right: SGPContactPanelInvoice): number {
    const leftSection = getInvoiceSectionKey(left);
    const rightSection = getInvoiceSectionKey(right);

    if (leftSection !== rightSection) {
        const sectionPriority: Record<SGPContactPanelInvoiceSectionKey, number> = {
            overdue: 0,
            open: 1,
            history: 2,
        };

        return sectionPriority[leftSection] - sectionPriority[rightSection];
    }

    if (leftSection === 'overdue') {
        if (left.daysLate !== right.daysLate) {
            return right.daysLate - left.daysLate;
        }

        return (parseDateValue(left.dueDate) ?? Number.POSITIVE_INFINITY) - (parseDateValue(right.dueDate) ?? Number.POSITIVE_INFINITY);
    }

    if (leftSection === 'open') {
        return (parseDateValue(left.dueDate) ?? Number.POSITIVE_INFINITY) - (parseDateValue(right.dueDate) ?? Number.POSITIVE_INFINITY);
    }

    const leftHistoryDate =
        parseDateValue(left.paymentDate) ??
        parseDateValue(left.cancellationDate) ??
        parseDateValue(left.dueDate) ??
        parseDateValue(left.issueDate) ??
        Number.NEGATIVE_INFINITY;
    const rightHistoryDate =
        parseDateValue(right.paymentDate) ??
        parseDateValue(right.cancellationDate) ??
        parseDateValue(right.dueDate) ??
        parseDateValue(right.issueDate) ??
        Number.NEGATIVE_INFINITY;

    return rightHistoryDate - leftHistoryDate;
}

function buildInvoiceSection(
    key: SGPContactPanelInvoiceSectionKey,
    label: string,
    description: string,
    invoices: SGPContactPanelInvoice[]
): SGPContactPanelInvoiceSection {
    const sortedInvoices = [...invoices].sort(compareInvoices);

    return {
        key,
        label,
        description,
        invoices: sortedInvoices,
        count: sortedInvoices.length,
        totalAmount: sortedInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0),
    };
}

function compareContractsByFinancialPriority(left: SGPContactPanelInvoiceGroup, right: SGPContactPanelInvoiceGroup): number {
    if (left.isUnassigned !== right.isUnassigned) {
        return left.isUnassigned ? 1 : -1;
    }

    if (left.summary.hasDebt !== right.summary.hasDebt) {
        return left.summary.hasDebt ? -1 : 1;
    }

    if (left.summary.overdueInvoices !== right.summary.overdueInvoices) {
        return right.summary.overdueInvoices - left.summary.overdueInvoices;
    }

    if (left.summary.overdueAmount !== right.summary.overdueAmount) {
        return right.summary.overdueAmount - left.summary.overdueAmount;
    }

    if (left.summary.openInvoices !== right.summary.openInvoices) {
        return right.summary.openInvoices - left.summary.openInvoices;
    }

    if (left.summary.openAmount !== right.summary.openAmount) {
        return right.summary.openAmount - left.summary.openAmount;
    }

    const leftConnectionPriority =
        left.contract?.connectionStatus === 'online'
            ? 0
            : left.contract?.connectionStatus === 'unknown'
                ? 1
                : 2;
    const rightConnectionPriority =
        right.contract?.connectionStatus === 'online'
            ? 0
            : right.contract?.connectionStatus === 'unknown'
                ? 1
                : 2;

    if (leftConnectionPriority !== rightConnectionPriority) {
        return leftConnectionPriority - rightConnectionPriority;
    }

    return left.title.localeCompare(right.title, 'pt-BR');
}

function buildContractGroup(contract: SGPContactPanelContract | null, invoices: SGPContactPanelInvoice[]): SGPContactPanelInvoiceGroup {
    const overdueInvoices = invoices.filter((invoice) => invoice.isOverdue);
    const openInvoices = invoices.filter((invoice) => !invoice.isOverdue && invoice.isOpen);
    const historyInvoices = invoices.filter((invoice) => !invoice.isOpen);
    const paidInvoices = historyInvoices.filter((invoice) => invoice.isPaid);
    const cancelledInvoices = historyInvoices.filter((invoice) => invoice.isCancelled);

    const invoiceSections = [
        buildInvoiceSection('overdue', 'Vencidas', 'Prioridade imediata', overdueInvoices),
        buildInvoiceSection('open', 'Em aberto', 'Proximos vencimentos', openInvoices),
        buildInvoiceSection('history', 'Historico', 'Pagas, canceladas ou finalizadas', historyInvoices),
    ];

    const summary = {
        overdueInvoices: overdueInvoices.length,
        openInvoices: openInvoices.length,
        historyInvoices: historyInvoices.length,
        paidInvoices: paidInvoices.length,
        cancelledInvoices: cancelledInvoices.length,
        totalInvoices: invoices.length,
        overdueAmount: overdueInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0),
        openAmount: openInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0),
        historyAmount: historyInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0),
        totalOutstandingAmount:
            overdueInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0) +
            openInvoices.reduce((sum, invoice) => sum + getInvoiceDisplayAmount(invoice), 0),
        hasDebt: overdueInvoices.length > 0,
    };

    if (!contract) {
        return {
            key: SGP_UNASSIGNED_INVOICE_GROUP_KEY,
            contractId: null,
            contract: null,
            title: 'Faturas sem contrato identificado',
            subtitle: 'O SGP retornou cobrancas sem um contrato correspondente confiavel.',
            isUnassigned: true,
            summary,
            invoiceSections,
        };
    }

    const subtitle = [contract.id ? `Contrato ${contract.id}` : null, contract.addressLabel || null]
        .filter(Boolean)
        .join(' - ');

    return {
        key: contract.id,
        contractId: contract.id,
        contract,
        title: contract.planDescription,
        subtitle: subtitle || null,
        isUnassigned: false,
        summary,
        invoiceSections,
    };
}

export function getContractId(rawContract: any): string {
    const contractId = rawContract?.contrato ?? rawContract?.id;
    return String(contractId ?? '').trim();
}

export function getPrimaryService(rawContract: any) {
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
        .join(' - ');
}

function buildSupportAddressLabel(rawContract: any): string {
    const line = [normalizeText(rawContract?.endereco_logradouro), normalizeText(rawContract?.endereco_numero)]
        .filter(Boolean)
        .join(', ');
    const neighborhood = normalizeText(rawContract?.endereco_bairro);
    const city = [normalizeText(rawContract?.endereco_cidade), normalizeText(rawContract?.endereco_uf)]
        .filter(Boolean)
        .join(' - ');
    const complement = normalizeText(rawContract?.endereco_complemento);
    const referencePoint = normalizeText(rawContract?.endereco_pontoreferencia);

    return [line, neighborhood, city, complement, referencePoint]
        .filter(Boolean)
        .join(' - ');
}

function normalizeConnectionStatus(value: unknown): 'online' | 'offline' | 'unknown' {
    const normalizedValue = normalizeStatusValue(value);
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

function normalizeSupportConnectionStatus(value: unknown): 'online' | 'offline' | 'unknown' {
    if (typeof value === 'boolean') {
        return value ? 'online' : 'offline';
    }

    const normalizedValue = normalizeStatusValue(value);
    if (!normalizedValue) {
        return 'unknown';
    }

    if (normalizedValue === '1' || normalizedValue === 'true' || normalizedValue === 'sim') {
        return 'online';
    }

    if (normalizedValue === '0' || normalizedValue === 'false' || normalizedValue === 'nao') {
        return 'offline';
    }

    return normalizeConnectionStatus(value);
}

function normalizeContractStatusTone(value: unknown): SGPContactPanelContract['statusTone'] {
    const normalizedValue = normalizeStatusValue(value);
    if (!normalizedValue) {
        return 'unknown';
    }

    if (
        normalizedValue.includes('cancelad') ||
        normalizedValue.includes('encerrad') ||
        normalizedValue.includes('desativad') ||
        normalizedValue.includes('inativ')
    ) {
        return 'cancelled';
    }

    if (normalizedValue.includes('suspens') || normalizedValue.includes('bloquead')) {
        return 'suspended';
    }

    if (
        normalizedValue.includes('ativ') ||
        normalizedValue.includes('habilitad') ||
        normalizedValue.includes('liberad')
    ) {
        return 'active';
    }

    return 'unknown';
}

function formatContractStatusLabel(
    rawStatus: string | null,
    statusTone: SGPContactPanelContract['statusTone'],
    connectionStatus: SGPContactPanelContract['connectionStatus']
): string {
    if (statusTone === 'active') {
        return 'Ativo';
    }

    if (statusTone === 'cancelled') {
        return 'Cancelado';
    }

    if (statusTone === 'suspended') {
        return 'Suspenso';
    }

    if (rawStatus) {
        return rawStatus;
    }

    if (connectionStatus === 'online') {
        return 'Online';
    }

    if (connectionStatus === 'offline') {
        return 'Offline';
    }

    return 'Sem status';
}

function buildSupportContractSnapshot(rawContract: any): SGPSupportContractSnapshot | null {
    const contractId = normalizeText(rawContract?.contrato_id);
    if (!contractId) {
        return null;
    }

    const ctoBase = normalizeText(rawContract?.servico_onu_cto);
    const ctoPort = normalizeText(rawContract?.servico_onu_cto_porta);
    const cto = ctoBase && ctoPort ? `${ctoBase} - Porta ${ctoPort}` : ctoBase || (ctoPort ? `Porta ${ctoPort}` : null);

    return {
        id: contractId,
        planDescription: normalizeText(rawContract?.plano),
        addressLabel: buildSupportAddressLabel(rawContract) || null,
        connectionStatus: normalizeSupportConnectionStatus(rawContract?.servico_online),
        rawStatus: normalizeText(rawContract?.contrato_status),
        ip: normalizeText(rawContract?.rad_ip),
        ipv6: normalizeText(rawContract?.rad_framedipv6prefix),
        delegatedIpv6: normalizeText(rawContract?.rad_delegatedipv6prefix),
        cto,
        geoLocation: normalizeText(rawContract?.contrato_endereco_ll) || normalizeText(rawContract?.endereco_ll),
        login: normalizeText(rawContract?.servico_login) || normalizeText(rawContract?.rad_username),
        mac: normalizeText(rawContract?.servico_mac) || normalizeText(rawContract?.rad_mac),
        connectedAt: normalizeText(rawContract?.rad_dataconexao),
        contractDate: normalizeText(rawContract?.contrato_cadastro),
    };
}

function getSupportContractSnapshotScore(snapshot: SGPSupportContractSnapshot): number {
    return [
        snapshot.connectionStatus === 'online' ? 1000 : snapshot.connectionStatus === 'unknown' ? 0 : -100,
        snapshot.ip ? 500 : 0,
        snapshot.ipv6 ? 100 : 0,
        snapshot.delegatedIpv6 ? 100 : 0,
        snapshot.connectedAt ? 50 : 0,
        snapshot.mac ? 25 : 0,
        snapshot.login ? 10 : 0,
    ].reduce((total, score) => total + score, 0);
}

function mergeSupportContractSnapshots(
    left: SGPSupportContractSnapshot,
    right: SGPSupportContractSnapshot
): SGPSupportContractSnapshot {
    const [preferred, fallback] = getSupportContractSnapshotScore(right) > getSupportContractSnapshotScore(left)
        ? [right, left]
        : [left, right];

    return {
        ...fallback,
        ...preferred,
        connectionStatus:
            preferred.connectionStatus !== 'unknown' ? preferred.connectionStatus : fallback.connectionStatus,
        planDescription: preferred.planDescription || fallback.planDescription,
        addressLabel: preferred.addressLabel || fallback.addressLabel,
        rawStatus: preferred.rawStatus || fallback.rawStatus,
        ip: preferred.ip || fallback.ip,
        ipv6: preferred.ipv6 || fallback.ipv6,
        delegatedIpv6: preferred.delegatedIpv6 || fallback.delegatedIpv6,
        cto: preferred.cto || fallback.cto,
        geoLocation: preferred.geoLocation || fallback.geoLocation,
        login: preferred.login || fallback.login,
        mac: preferred.mac || fallback.mac,
        connectedAt: preferred.connectedAt || fallback.connectedAt,
        contractDate: preferred.contractDate || fallback.contractDate,
    };
}

function buildSupportContractLookup(rawContracts: any[]): {
    exactLookup: Map<string, SGPSupportContractSnapshot>;
    normalizedLookup: Map<string, SGPSupportContractSnapshot>;
} {
    const exactLookup = new Map<string, SGPSupportContractSnapshot>();
    const normalizedLookup = new Map<string, SGPSupportContractSnapshot>();

    for (const snapshot of rawContracts.map(buildSupportContractSnapshot)) {
        if (!snapshot) {
            continue;
        }

        const exactSnapshot = exactLookup.get(snapshot.id);
        exactLookup.set(
            snapshot.id,
            exactSnapshot ? mergeSupportContractSnapshots(exactSnapshot, snapshot) : snapshot
        );

        const normalizedKey = normalizeContractLookupKey(snapshot.id);
        if (normalizedKey) {
            const normalizedSnapshot = normalizedLookup.get(normalizedKey);
            normalizedLookup.set(
                normalizedKey,
                normalizedSnapshot ? mergeSupportContractSnapshots(normalizedSnapshot, snapshot) : snapshot
            );
        }
    }

    return { exactLookup, normalizedLookup };
}

function resolveSupportContractSnapshot(
    contractId: string,
    exactLookup: Map<string, SGPSupportContractSnapshot>,
    normalizedLookup: Map<string, SGPSupportContractSnapshot>
): SGPSupportContractSnapshot | null {
    const exactMatch = exactLookup.get(contractId);
    if (exactMatch) {
        return exactMatch;
    }

    const normalizedKey = normalizeContractLookupKey(contractId);
    if (!normalizedKey) {
        return null;
    }

    return normalizedLookup.get(normalizedKey) ?? null;
}

function buildContractDetails(
    rawContract: any,
    supportLookups?: {
        exactLookup: Map<string, SGPSupportContractSnapshot>;
        normalizedLookup: Map<string, SGPSupportContractSnapshot>;
    }
): SGPContactPanelContract {
    const primaryService = getPrimaryService(rawContract);
    const connection = primaryService?.onu?.conexao ?? null;
    const contractId = getContractId(rawContract);
    const supportContract = supportLookups
        ? resolveSupportContractSnapshot(contractId, supportLookups.exactLookup, supportLookups.normalizedLookup)
        : null;
    const rawStatus = normalizeText(rawContract?.status) || supportContract?.rawStatus || null;
    const primaryConnectionStatus = normalizeConnectionStatus(connection?.status);
    const connectionStatus =
        primaryConnectionStatus !== 'unknown' ? primaryConnectionStatus : supportContract?.connectionStatus || 'unknown';
    const statusTone = normalizeContractStatusTone(rawStatus);
    const ip = supportContract?.ip || normalizeText(connection?.ip) || normalizeText(primaryService?.ip);
    const ipv6 = supportContract?.ipv6 || null;
    const delegatedIpv6 = supportContract?.delegatedIpv6 || null;
    const mac = normalizeText(primaryService?.mac) || supportContract?.mac || null;
    const login = normalizeText(primaryService?.login) || supportContract?.login || null;
    const serial = normalizeText(primaryService?.onu?.serial);
    const cto = supportContract?.cto || null;
    const detailParts = [
        ip ? `IPv4: ${ip}` : null,
        ipv6 ? `IPv6: ${ipv6}` : null,
        cto ? `CTO: ${cto}` : null,
        !ip && !ipv6 && mac ? `MAC: ${mac}` : null,
        !ip && !ipv6 && !mac && login ? `PPPoE: ${login}` : null,
        !ip && !ipv6 && !mac && !login && serial ? `Serial: ${serial}` : null,
    ].filter(Boolean);
    const addressLabel =
        supportContract?.addressLabel ||
        buildAddressLabel(primaryService?.endereco) ||
        buildAddressLabel(rawContract?.endereco) ||
        buildAddressLabel(rawContract?.cliente_endereco);

    return {
        id: contractId,
        planDescription:
            normalizeText(primaryService?.plano?.descricao) ||
            supportContract?.planDescription ||
            normalizeText(rawContract?.status) ||
            `Contrato ${contractId}`,
        serviceType: normalizeText(primaryService?.tipo),
        connectionStatus,
        statusTone,
        statusLabel: formatContractStatusLabel(rawStatus, statusTone, connectionStatus),
        detailsLabel: detailParts.join(' - ') || 'Sem detalhes de conexao',
        addressLabel: addressLabel || 'Endereco nao informado',
        login,
        ip,
        ipv6,
        delegatedIpv6,
        mac,
        serial,
        cto,
        geoLocation: supportContract?.geoLocation || null,
        connectedAt: normalizeText(connection?.data_conexao) || supportContract?.connectedAt || null,
        disconnectedAt: normalizeText(connection?.data_desconexao),
        contractDate: normalizeText(rawContract?.dataCadastro) || supportContract?.contractDate || null,
        reason: normalizeText(rawContract?.motivo_status),
    };
}

function buildInvoiceDetails(rawInvoice: any): SGPContactPanelInvoice {
    const dueDate = normalizeText(rawInvoice?.dataVencimento);
    const paymentDate = normalizeText(rawInvoice?.dataPagamento);
    const cancellationDate = normalizeText(rawInvoice?.dataCancelamento);
    const status = normalizeInvoiceStatus(rawInvoice?.status);
    const isOpen = status === 'aberto' || status === 'abertos';
    const isPaid = status === 'pago' || status === 'pagos' || status === 'recebido';
    const isCancelled = status === 'cancelado' || status === 'cancelada' || status === 'cancelados';
    const dueTimestamp = dueDate ? new Date(`${dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
        id: String(rawInvoice?.id ?? '').trim(),
        contractId: String(
            rawInvoice?.clienteContrato ??
            rawInvoice?.clientecontrato_id ??
            rawInvoice?.clientecontratoId ??
            rawInvoice?.clientecontrato ??
            rawInvoice?.contrato ??
            ''
        ).trim(),
        status: status || 'desconhecido',
        amount: toNumber(rawInvoice?.valor),
        correctedAmount: toNumber(rawInvoice?.valorCorrigido || rawInvoice?.valor),
        daysLate: toNumber(rawInvoice?.diasAtraso),
        dueDate,
        issueDate: normalizeText(rawInvoice?.dataEmissao),
        paymentDate,
        cancellationDate,
        barcode: normalizeText(rawInvoice?.codigoBarras),
        digitableLine: normalizeText(rawInvoice?.linhaDigitavel),
        paymentLink: normalizeText(rawInvoice?.link),
        pixCode: normalizeText(rawInvoice?.codigoPix),
        isOpen,
        isPaid,
        isCancelled,
        isOverdue: isOpen && dueTimestamp < today.getTime(),
    };
}

function resolveContractFromInvoice(
    invoice: SGPContactPanelInvoice,
    exactLookup: Map<string, SGPContactPanelContract>,
    normalizedLookup: Map<string, SGPContactPanelContract>
): SGPContactPanelContract | null {
    if (!invoice.contractId) {
        return null;
    }

    const exactMatch = exactLookup.get(invoice.contractId);
    if (exactMatch) {
        return exactMatch;
    }

    const normalizedKey = normalizeContractLookupKey(invoice.contractId);
    if (!normalizedKey) {
        return null;
    }

    return normalizedLookup.get(normalizedKey) ?? null;
}

export function buildSGPContactPanelData(clientes: any[], supportContracts: any[] = []): SGPContactPanelData | null {
    if (!Array.isArray(clientes) || clientes.length === 0) {
        return null;
    }

    const customerName = normalizeText(clientes[0]?.nome) || 'Cliente';
    const cpfCnpj = normalizeText(clientes[0]?.cpfcnpj) || '';
    const supportLookups = buildSupportContractLookup(Array.isArray(supportContracts) ? supportContracts : []);
    const contracts = clientes
        .flatMap((cliente) => (Array.isArray(cliente?.contratos) ? cliente.contratos : []))
        .map((contract) => buildContractDetails(contract, supportLookups))
        .filter((contract) => contract.id);

    const contractLookup = new Map<string, SGPContactPanelContract>();
    const normalizedContractLookup = new Map<string, SGPContactPanelContract>();
    for (const contract of contracts) {
        contractLookup.set(contract.id, contract);

        const normalizedKey = normalizeContractLookupKey(contract.id);
        if (normalizedKey && !normalizedContractLookup.has(normalizedKey)) {
            normalizedContractLookup.set(normalizedKey, contract);
        }
    }

    const invoiceMap = new Map<string, SGPContactPanelInvoice>();
    clientes
        .flatMap((cliente) => (Array.isArray(cliente?.titulos) ? cliente.titulos : []))
        .map(buildInvoiceDetails)
        .filter((invoice) => invoice.id)
        .forEach((invoice) => {
            invoiceMap.set(invoice.id, invoice);
        });

    const invoices = [...invoiceMap.values()].sort(compareInvoices);
    const invoicesByGroupKey = new Map<string, SGPContactPanelInvoice[]>();

    for (const invoice of invoices) {
        const contract = resolveContractFromInvoice(invoice, contractLookup, normalizedContractLookup);
        const groupKey = contract?.id ?? SGP_UNASSIGNED_INVOICE_GROUP_KEY;
        const currentInvoices = invoicesByGroupKey.get(groupKey) ?? [];
        currentInvoices.push(invoice);
        invoicesByGroupKey.set(groupKey, currentInvoices);
    }

    const invoiceGroups = contracts
        .map((contract) => buildContractGroup(contract, invoicesByGroupKey.get(contract.id) ?? []))
        .sort(compareContractsByFinancialPriority);

    const unassignedInvoices = invoicesByGroupKey.get(SGP_UNASSIGNED_INVOICE_GROUP_KEY) ?? [];
    if (unassignedInvoices.length > 0) {
        invoiceGroups.push(buildContractGroup(null, unassignedInvoices));
    }

    return {
        customerName,
        cpfCnpj,
        contracts: invoiceGroups.flatMap((group) => (group.contract ? [group.contract] : [])),
        invoices,
        invoiceGroups,
        onlineContracts: contracts.filter((contract) => contract.connectionStatus === 'online').length,
        overdueInvoices: invoices.filter((invoice) => invoice.isOverdue).length,
        openInvoices: invoices.filter((invoice) => !invoice.isOverdue && invoice.isOpen).length,
    };
}
