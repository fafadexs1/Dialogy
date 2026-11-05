import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ panel: vi.fn(), lookup: vi.fn() }));
vi.mock('@/services/agent-tools/sgp-tools', () => ({ runSgpWorkspaceTool: mocks.panel, lookupSgpCustomerContracts: mocks.lookup }));
import { parseStudioSgpQuery, projectStudioSgpQuery } from '@/services/agent-studio/sgp-query';
import { createStudioSgpMultiProcedure } from '@/services/agent-studio/sgp-template';
import { executeStudioSgp } from '@/services/agent-studio/sgp-runtime';
import { advanceStudioReasoningSession } from '@/services/agent-studio/reasoning-engine';
import { createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import { createStudioSession } from '@/services/agent-studio/engine';
import type { StudioReasoningDecision } from '@/services/agent-studio/reasoning-contract';

const fixture = () => ({ customerName: 'Titular', contracts: [
  { id: '1', addressLabel: 'Rua Azul, casa 10', connectionStatus: 'online' }, { id: '2', addressLabel: 'Rua Azul, casa 20', connectionStatus: 'offline' },
], invoices: ['1', '2'].flatMap((contractId) => [
  { id: `${contractId}a`, contractId, issueDate: '2026-10-01', dueDate: '2026-10-10', isOpen: true, paymentLink: `https://example.test/${contractId}a` },
  { id: `${contractId}b`, contractId, issueDate: '2026-09-01', dueDate: '2026-09-10', isPaid: true },
  { id: `${contractId}c`, contractId, issueDate: '2026-08-01', dueDate: '2026-12-10', isPaid: true },
]) });
const query = (extra = {}) => parseStudioSgpQuery({ contractIds: ['1', '2'], sourceMessageId: 'm1', quote: 'Quero duas faturas de cada contrato', invoices: { limit: 2, distribution: 'per_contract', orderBy: 'issueDate', status: 'all' }, ...extra });
beforeEach(() => vi.resetAllMocks());
describe('precise multi-contract consultation', () => {
  it('selects two most recent per contract, without mixing dates, addresses or links', () => {
    const result = projectStudioSgpQuery(fixture(), query());
    expect(result.selected_invoices.map((entry) => entry.id)).toEqual(['1a', '1b', '2a', '2b']);
    expect(result.contract_results.map((entry) => [entry.contractId, entry.address])).toEqual([['1', 'Rua Azul, casa 10'], ['2', 'Rua Azul, casa 20']]);
    expect(result.query_complete).toBe(true);
    expect(result.customer_ip).toBeNull();
  });
  it('distinguishes two in total from two per contract and uses emission instead of future due dates', () => {
    expect(projectStudioSgpQuery(fixture(), query({ invoices: { limit: 2, distribution: 'total', orderBy: 'issueDate', status: 'all' } })).selected_invoices.map((entry) => entry.id)).toEqual(['1a', '2a']);
  });
  it('excludes cancelled, duplicate and unassigned invoices and reports insufficient data', () => {
    const out = fixture(); out.invoices.push({ ...out.invoices[0] });
    out.invoices[1] = { ...out.invoices[1], isCancelled: true } as any;
    out.invoices[2].issueDate = '';
    out.invoices.push({ id: 'unknown', contractId: '', issueDate: '2026-11-01' } as any);
    const result = projectStudioSgpQuery(out, query());
    expect(result.contract_results[0].invoices).toHaveLength(1);
    expect(result.contract_results[0].unknownDateCount).toBe(1);
    expect(result.unassigned_invoice_count).toBe(1);
    expect(result.query_complete).toBe(false);
  });
  it('rejects foreign and duplicated contracts', () => {
    expect(() => projectStudioSgpQuery(fixture(), query({ contractIds: ['999'] }))).toThrow('não pertence');
    expect(() => query({ contractIds: ['1', '1'] })).toThrow('repetidos');
  });
  it('ranks Brazilian dates correctly and rejects impossible dates', () => {
    const out = fixture();
    out.invoices[0].issueDate = '01/12/2026';
    out.invoices[1].issueDate = '02/11/2026';
    out.invoices[2].issueDate = '31/02/2026';
    const result = projectStudioSgpQuery(out, query({ contractIds: ['1'] }));
    expect(result.selected_invoices.map((entry) => entry.id)).toEqual(['1a', '1b']);
    expect(result.query_complete).toBe(false);
  });
  it('keeps a single-contract query scoped, including financial and connection summaries', async () => {
    const step = createStudioSgpMultiProcedure('sgp').steps[2]; mocks.panel.mockResolvedValue({ status: 'success', output: fixture() });
    const result = await executeStudioSgp({ workspaceId: 'workspace', chatId: 'chat', step, query: query({ contractIds: ['2'] }), context: { values: { customer_cpf: '52998224725' } } });
    expect(result.values.open_invoices).toBe(1);
    expect(result.values.connection_status).toBe('offline');
    expect((result.values.selected_invoices as any[]).every((entry) => entry.contractId === '2')).toBe(true);
  });

  it('handles independent requests for two installations and preserves a pending task through a topic change', async () => {
    const doc = createDefaultAgentStudioDocument('agent', 'workspace'); doc.resolveStage.procedures = [createStudioSgpMultiProcedure('sgp')];
    // Shared contract listing is no prerequisite in this fixture; focus on actual request isolation.
    doc.resolveStage.procedures[0].steps[2].adaptiveAccess!.requiresSteps = [];
    const request = (id: string, status: 'active' | 'resolved' = 'active') => ({ id, status, procedureId: 'sgp', objective: id === 'invoices' ? 'Faturas das duas instalações' : 'Conexão da casa 20' });
    const decision = (kind: 'tool' | 'respond', requestId: string | null, q: unknown, requests: any[] = []): StudioReasoningDecision => ({ requests, choices: [], action: { kind, requestId, capabilityId: kind === 'tool' ? 'sgp:sgp_panel' : null, query: q ? JSON.stringify(q) : null, response: kind === 'respond' ? 'Faturas separadas por instalação; a conexão da casa 20 continua em análise.' : null, consent: 'none', consentQuote: null, reason: '' } });
    const decide = vi.fn().mockResolvedValueOnce(decision('tool', 'invoices', query(), [request('invoices'), request('connection')]))
      .mockResolvedValueOnce(decision('tool', 'connection', query({ contractIds: ['2'], invoices: undefined })))
      .mockResolvedValueOnce(decision('respond', null, null, [request('invoices', 'resolved')]));
    mocks.panel.mockResolvedValue({ status: 'success', output: fixture() });
    const execute = vi.fn(async (step, context, operation) => executeStudioSgp({ workspaceId: 'workspace', chatId: 'chat', step, context, query: operation.sgpQuery }));
    const dependencies = { decide, execute, checkpoint: vi.fn(async () => {}), recall: async () => ({ records: [], nextCursor: null }), knowledge: async () => null, handoff: async () => {} };
    const result = await advanceStudioReasoningSession({ document: doc, state: createStudioSession(doc.id, 'release', 'session'), messageId: 'm1', message: 'Quero duas faturas de cada contrato e verificar a conexão da casa 20', context: { contact: { custom_fields: { sgp_document: '52998224725' } } }, sources: [], memory: { records: [], nextCursor: null }, dependencies });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.state.reasoning!.requests.find((entry) => entry.id === 'invoices')?.integrationValues.selected_contract_ids).toEqual(['1', '2']);
    expect(result.state.reasoning!.requests.find((entry) => entry.id === 'connection')?.integrationValues.selected_contract_ids).toEqual(['2']);
    expect(result.state.reasoning!.requests.find((entry) => entry.id === 'connection')?.status).toBe('active');
    expect(result.state.status).not.toBe('resolved');
    decide.mockResolvedValueOnce(decision('respond', null, null));
    const resumed = await advanceStudioReasoningSession({ document: doc, state: result.state, messageId: 'm2', message: 'E qual é meu plano?', context: { contact: { custom_fields: { sgp_document: '52998224725' } } }, sources: [], memory: { records: [], nextCursor: null }, dependencies });
    expect(resumed.state.reasoning!.requests.find((entry) => entry.id === 'connection')?.status).toBe('active');
    expect(resumed.state.reasoning!.requests.find((entry) => entry.id === 'invoices')?.status).toBe('resolved');
    mocks.panel.mockRejectedValueOnce(new Error('SGP indisponível'));
    decide.mockResolvedValueOnce(decision('tool', 'connection', query({ contractIds: ['2'], invoices: undefined, sourceMessageId: 'm3', quote: 'Verifique novamente a casa 20' })))
      .mockResolvedValueOnce(decision('respond', null, null, [request('connection', 'resolved')]))
      .mockResolvedValueOnce(decision('respond', null, null));
    const failed = await advanceStudioReasoningSession({ document: doc, state: resumed.state, messageId: 'm3', message: 'Verifique novamente a casa 20', context: { contact: { custom_fields: { sgp_document: '52998224725' } } }, sources: [], memory: { records: [], nextCursor: null }, dependencies });
    const connection = failed.state.reasoning!.requests.find((entry) => entry.id === 'connection')!;
    expect(connection.status).toBe('active');
    expect(connection.integrationValues.selected_contract_ids).toBeUndefined();
    expect(failed.state.reasoning!.requests.find((entry) => entry.id === 'invoices')!.integrationValues.selected_invoices).toHaveLength(4);
  });
});
