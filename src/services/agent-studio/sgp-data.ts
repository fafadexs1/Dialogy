import type { ProcedureStep } from './types';

export const STUDIO_SGP_ACTIONS = ['sgp_fetch_contracts', 'sgp_fetch_contact_panel_data'];
export function studioSgpOutputs(step: ProcedureStep) {
  if (!STUDIO_SGP_ACTIONS.includes(step.nativeActionType || '')) return [];
  const keys = ['contracts', 'contracts_count', 'cpf_cnpj', 'contract_selection_required', 'customer_ip', 'customer_mac', 'contract_ip', 'contract_mac'];
  if (step.nativeActionType === 'sgp_fetch_contact_panel_data') keys.push('customer_name', 'online_contracts', 'invoices', 'open_invoices', 'overdue_invoices', 'invoice_groups', 'connection_status', 'login', 'ip_address', 'mac_address');
  if (step.nativeActionPayload?.flexibleScope === true) keys.push('selected_contract_ids', 'contract_results', 'selected_invoices', 'invoice_query', 'unassigned_invoice_count', 'query_complete');
  const labels: Record<string, string> = { contracts: 'Contratos do SGP', contracts_count: 'Quantidade de contratos', cpf_cnpj: 'Documento consultado', contract_selection_required: 'Precisa escolher contrato', customer_name: 'Titular', invoices: 'Faturas', open_invoices: 'Quantidade de faturas em aberto', overdue_invoices: 'Quantidade de faturas vencidas', online_contracts: 'Quantidade de conexões online', invoice_groups: 'Financeiro por contrato', connection_status: 'Estado da conexão' };
  return keys.map((chipKey) => ({ chipKey, chipLabel: labels[chipKey] || chipKey, sensitive: ['cpf_cnpj', 'customer_ip', 'customer_mac', 'contract_ip', 'contract_mac', 'ip_address', 'mac_address', 'login'].includes(chipKey), required: !['customer_ip', 'customer_mac', 'contract_ip', 'contract_mac', 'ip_address', 'mac_address', 'login'].includes(chipKey) }));
}

/** A summary may span contracts. Equipment identifiers require an exact selection. */
export function studioSgpPanelValues(out: Record<string, any>, contractId?: string) {
  if (contractId && out.requestedContractFound === false) throw new Error('O contrato escolhido não pertence ao documento consultado.');
  const contracts = Array.isArray(out.contracts) ? out.contracts.map((entry: any) => ({ ...entry,
    label: entry.label || `${entry.id} - ${entry.planDescription || entry.plan || 'Plano'}${entry.addressLabel ? ` - ${entry.addressLabel}` : ''}`,
  })) : [];
  const selected = contractId ? contracts.find((entry: any) => String(entry.id) === contractId) : contracts.length === 1 ? contracts[0] : null;
  if (contractId && !selected) throw new Error('O contrato escolhido não está disponível no SGP.');
  return { customer_name: out.customerName || null, cpf_cnpj: out.cpfCnpj || null,
    contracts, contracts_count: contracts.length, contract_selection_required: contracts.length > 1 && !selected,
    online_contracts: out.onlineContracts ?? 0, invoices: out.invoices || [], open_invoices: out.openInvoices ?? 0,
    overdue_invoices: out.overdueInvoices ?? 0, invoice_groups: out.invoiceGroups || [],
    customer_ip: selected?.ip || null, contract_ip: selected?.ip || null, ip_address: selected?.ip || null,
    customer_mac: selected?.mac || null, contract_mac: selected?.mac || null, mac_address: selected?.mac || null,
    login: selected?.login || null, connection_status: selected?.connectionStatus || null };
}
