
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
    statusLabel: string;
    detailsLabel: string;
    addressLabel: string;
    login: string | null;
    ip: string | null;
    mac: string | null;
    serial: string | null;
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
    pixCode: string | null;
    isOverdue: boolean;
}

export interface SGPContactPanelData {
    customerName: string;
    cpfCnpj: string;
    contracts: SGPContactPanelContract[];
    invoices: SGPContactPanelInvoice[];
    onlineContracts: number;
    overdueInvoices: number;
    openInvoices: number;
}

export type SGPConfig = SGPGlobalConfig & SGPUserConfig;
