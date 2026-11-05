import { studioSgpPanelValues } from './sgp-data';
import { z } from 'zod';

export const StudioSgpQuerySchema = z.object({
  contractIds: z.array(z.string().regex(/^\d+$/)).min(1).max(50),
  invoices: z.object({ limit: z.number().int().min(1).max(10), distribution: z.enum(['per_contract', 'total']),
    orderBy: z.enum(['issueDate', 'dueDate']), status: z.enum(['all', 'open', 'overdue']) }).strict().optional(),
  sourceMessageId: z.string().min(1), quote: z.string().min(1).max(4000),
}).strict();
export type StudioSgpQuery = z.infer<typeof StudioSgpQuerySchema>;
export function parseStudioSgpQuery(raw: unknown) {
  const query = StudioSgpQuerySchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  if (new Set(query.contractIds).size !== query.contractIds.length) throw new Error('Há contratos repetidos na consulta.');
  return query;
}

function invoiceDate(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!iso && !br) return NaN;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(br![3]), Number(br![2]), Number(br![1])];
  const timestamp = Date.UTC(year, month - 1, day), parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? timestamp : NaN;
}

/** Validate scope from the fresh server response, then select and rank without model arithmetic. */
export function selectStudioSgpQuery(out: Record<string, any>, query: StudioSgpQuery) {
  const contracts: any[] = Array.isArray(out.contracts) ? out.contracts : [];
  if (query.contractIds.some((id) => !contracts.some((entry) => String(entry.id) === id))) throw new Error('Um contrato solicitado não pertence ao titular consultado.');
  const selected = contracts.filter((entry) => query.contractIds.includes(String(entry.id)));
  const allInvoices: any[] = Array.isArray(out.invoices) ? out.invoices : [];
  const invoices = allInvoices.filter((entry) => query.contractIds.includes(String(entry.contractId)) && !entry.isCancelled);
  const groups = selected.map((contract) => {
    const seen = new Set<string>();
    const eligible = invoices.filter((entry) => String(entry.contractId) === String(contract.id)
      && (!query.invoices || query.invoices.status === 'all' || (query.invoices.status === 'open' ? entry.isOpen : entry.isOverdue)))
      .filter((entry) => { if (!entry.id || seen.has(String(entry.id))) return false; seen.add(String(entry.id)); return true; });
    const date = (entry: any) => invoiceDate(entry[query.invoices?.orderBy || 'issueDate']);
    const ranked = eligible.filter((entry) => Number.isFinite(date(entry))).sort((a, b) => date(b) - date(a) || String(a.id).localeCompare(String(b.id)));
    return { contractId: String(contract.id), address: contract.addressLabel || null, plan: contract.planDescription || null,
      connectionStatus: contract.connectionStatus || 'unknown', contract,
      eligibleCount: eligible.length, unknownDateCount: eligible.length - ranked.length,
      invoices: query.invoices ? ranked.slice(0, query.invoices.distribution === 'per_contract' ? query.invoices.limit : 500) : [] };
  });
  if (query.invoices?.distribution === 'total') {
    const key = query.invoices.orderBy;
    const recent = groups.flatMap((group) => group.invoices).sort((a, b) => invoiceDate(b[key]) - invoiceDate(a[key]) || `${a.contractId}:${a.id}`.localeCompare(`${b.contractId}:${b.id}`)).slice(0, query.invoices.limit);
    for (const group of groups) group.invoices = recent.filter((entry) => String(entry.contractId) === group.contractId);
  }
  return { selected_contract_ids: query.contractIds, contract_results: groups,
    selected_invoices: groups.flatMap((group) => group.invoices), invoice_query: query.invoices || null,
    unassigned_invoice_count: allInvoices.filter((entry) => !entry.contractId).length,
    query_complete: !query.invoices || (groups.every((group) => group.unknownDateCount === 0)
      && (query.invoices.distribution === 'per_contract' ? groups.every((group) => group.invoices.length >= query.invoices!.limit) : groups.reduce((count, group) => count + group.invoices.length, 0) >= query.invoices.limit)),
  };
}

export function projectStudioSgpQuery(out: Record<string, any>, query: StudioSgpQuery) {
  const values = studioSgpPanelValues(out);
  const selected = selectStudioSgpQuery(out, query);
  const scopedContracts = values.contracts.filter((entry: any) => query.contractIds.includes(String(entry.id)));
  const scopedInvoices = values.invoices.filter((entry: any) => query.contractIds.includes(String(entry.contractId)));
  const scoped = studioSgpPanelValues({ ...out, contracts: scopedContracts, invoices: scopedInvoices,
    openInvoices: scopedInvoices.filter((entry: any) => entry.isOpen && !entry.isCancelled).length,
    overdueInvoices: scopedInvoices.filter((entry: any) => entry.isOverdue && !entry.isCancelled).length,
    onlineContracts: scopedContracts.filter((entry: any) => entry.connectionStatus === 'online').length,
    invoiceGroups: values.invoice_groups.filter((entry: any) => query.contractIds.includes(String(entry.contractId))),
  });
  return { ...scoped, contracts: values.contracts, contracts_count: values.contracts_count,
    invoices: query.invoices ? selected.selected_invoices : scopedInvoices, ...selected };
}
