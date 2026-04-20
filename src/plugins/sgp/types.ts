
export interface SGPGlobalConfig {
    baseUrl?: string;
    cpfFieldId?: string;
    appId?: string;
    appToken?: string;
    teamSectors?: Record<string, string>;
}

export interface SGPUserConfig {
    username?: string;
    password?: string;
    token?: string;
}

export interface SGPContactPanelContract {
    id: string;
    planDescription: string;
    serviceType: string | null;
    connectionStatus: 'online' | 'offline' | 'unknown';
    statusTone: 'active' | 'cancelled' | 'suspended' | 'unknown';
    statusLabel: string;
    detailsLabel: string;
    addressLabel: string;
    login: string | null;
    ip: string | null;
    ipv6: string | null;
    delegatedIpv6: string | null;
    mac: string | null;
    serial: string | null;
    cto: string | null;
    geoLocation: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    contractDate: string | null;
    reason: string | null;
}

export interface SGPContactPanelInvoice {
    id: string;
    contractId: string;
    status: string;
    amount: number;
    correctedAmount: number;
    daysLate: number;
    dueDate: string | null;
    issueDate: string | null;
    paymentDate: string | null;
    cancellationDate: string | null;
    barcode: string | null;
    digitableLine: string | null;
    paymentLink: string | null;
    pixCode: string | null;
    isOpen: boolean;
    isPaid: boolean;
    isCancelled: boolean;
    isOverdue: boolean;
}

export type SGPContactPanelInvoiceSectionKey = 'overdue' | 'open' | 'history';

export interface SGPContactPanelInvoiceSection {
    key: SGPContactPanelInvoiceSectionKey;
    label: string;
    description: string;
    invoices: SGPContactPanelInvoice[];
    count: number;
    totalAmount: number;
}

export interface SGPContactPanelContractFinancialSummary {
    overdueInvoices: number;
    openInvoices: number;
    historyInvoices: number;
    paidInvoices: number;
    cancelledInvoices: number;
    totalInvoices: number;
    overdueAmount: number;
    openAmount: number;
    historyAmount: number;
    totalOutstandingAmount: number;
    hasDebt: boolean;
}

export interface SGPContactPanelInvoiceGroup {
    key: string;
    contractId: string | null;
    contract: SGPContactPanelContract | null;
    title: string;
    subtitle: string | null;
    isUnassigned: boolean;
    summary: SGPContactPanelContractFinancialSummary;
    invoiceSections: SGPContactPanelInvoiceSection[];
}

export const SGP_UNASSIGNED_INVOICE_GROUP_KEY = '__sgp-unassigned__';

export interface SGPContactPanelData {
    customerName: string;
    cpfCnpj: string;
    contracts: SGPContactPanelContract[];
    invoices: SGPContactPanelInvoice[];
    invoiceGroups: SGPContactPanelInvoiceGroup[];
    onlineContracts: number;
    overdueInvoices: number;
    openInvoices: number;
}

export interface SGPPaymentPromiseResponse {
    status?: number | null;
    razaoSocial?: string | null;
    protocolo?: string | null;
    liberado?: boolean | null;
    liberado_dias?: number | null;
    cpfCnpj?: string | null;
    msg?: string | null;
    contratoId?: number | string | null;
}

export type SGPConfig = SGPGlobalConfig & SGPUserConfig;
