import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), panel: vi.fn() }));
vi.mock('@/services/agent-tools/sgp-tools', () => ({ lookupSgpCustomerContracts: mocks.lookup, runSgpWorkspaceTool: mocks.panel }));
import { executeStudioSgp } from '@/services/agent-studio/sgp-runtime';
import { studioSgpPanelValues } from '@/services/agent-studio/sgp-data';
import { createStudioSgpProcedure } from '@/services/agent-studio/sgp-template';
import { availableStudioData } from '@/services/agent-studio/data-availability';
import { createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import { advanceStudioSession, createStudioSession } from '@/services/agent-studio/engine';
import { advanceStudioReasoningSession } from '@/services/agent-studio/reasoning-engine';
import { checkStudioDependencies } from '@/services/agent-studio/publication-checks';

beforeEach(() => vi.resetAllMocks());
const procedure = () => createStudioSgpProcedure('sgp');
describe('Studio SGP integration', () => {
  it('publishes financial and connection outputs for subsequent responses', () => {
    const doc = createDefaultAgentStudioDocument('agent', 'workspace');
    const p = procedure(); doc.resolveStage.procedures = [p];
    const data = availableStudioData(doc, p, 4);
    expect(data.find((entry) => entry.key === 'invoices')?.guaranteed).toBe(true);
    expect(data.find((entry) => entry.key === 'contracts')?.guaranteed).toBe(true);
    expect(data.find((entry) => entry.key === 'customer_ip')?.guaranteed).toBe(false);
    expect(checkStudioDependencies(doc).filter((issue) => issue.procedureId === p.id)).toEqual([]);
  });
  it('never selects equipment from the first of multiple contracts', () => {
    const values = studioSgpPanelValues({ contracts: [{ id: '1', ip: '192.0.2.1' }, { id: '2', ip: '192.0.2.2' }], invoices: [{ id: 'invoice' }] });
    expect(values.contract_selection_required).toBe(true);
    expect(values.customer_ip).toBeNull();
    expect(values.invoices).toHaveLength(1);
    expect(studioSgpPanelValues({ contracts: [{ id: '1', ip: '192.0.2.1' }, { id: '2', ip: '192.0.2.2' }] }, '2').customer_ip).toBe('192.0.2.2');
  });
  it('uses explicitly mapped variables and validates ownership of the selected contract', async () => {
    const step = procedure().steps[3];
    step.nativeDataMappings = [{ apiField: 'customerIdentifier', sourceType: 'flow_input', sourceValue: 'document' }, { apiField: 'contractId', sourceType: 'collected_field', sourceValue: 'chosen' }];
    mocks.panel.mockResolvedValue({ status: 'success', output: { requestedContractFound: false, contracts: [] } });
    await expect(executeStudioSgp({ workspaceId: 'workspace', chatId: 'chat', step, context: { values: { chosen: '2' }, input: { document: '529.982.247-25' } } })).rejects.toThrow('não pertence');
    expect(mocks.panel).toHaveBeenCalledWith({ workspaceId: 'workspace', chatId: 'chat', customerIdentifier: '52998224725' }, { type: 'sgp_fetch_contact_panel_data', payload: { contractId: '2' } });
  });
  it('rejects invalid documents before contacting SGP', async () => {
    await expect(executeStudioSgp({ workspaceId: 'workspace', chatId: 'chat', step: procedure().steps[1], context: { values: { customer_cpf: '11111111111' } } })).rejects.toThrow('inválido');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it('reuses a valid mapped CRM document and skips the only contract choice', async () => {
    const doc = createDefaultAgentStudioDocument('agent', 'workspace'); doc.understandStage.welcomeMessage = '';
    doc.resolveStage.procedures = [procedure()];
    const execute = vi.fn(async (step: any) => step.nativeActionType === 'sgp_fetch_contracts' ? { values: { contracts: [{ id: '1', label: 'Instalação única' }] } } : { values: { customer_name: 'Cliente', contracts: [], open_invoices: 0, overdue_invoices: 0, connection_status: 'online' } });
    const result = await advanceStudioSession({ document: doc, state: createStudioSession(doc.id, 'release', 'session'), messageId: 'm1', message: 'Consultar minha conexão', context: { contact: { custom_fields: { sgp_document: '52998224725' } } }, dependencies: { chooseProcedure: async () => 'sgp', execute, knowledge: async () => null, handoff: async () => {}, checkpoint: async () => {} } });
    expect(result.state.values.customer_cpf).toBe('52998224725');
    expect(result.state.values.customer_contract).toBe('1');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('asks for a missing document before executing any SGP query', async () => {
    const doc = createDefaultAgentStudioDocument('agent', 'workspace'); doc.resolveStage.procedures = [procedure()];
    const execute = vi.fn();
    const result = await advanceStudioSession({ document: doc, state: createStudioSession(doc.id, 'release', 'session'), messageId: 'm1', message: 'Consultar conexão', context: { contact: { custom_fields: { sgp_document: 'inválido' } } }, dependencies: { chooseProcedure: async () => 'sgp', execute, knowledge: async () => null, handoff: async () => {}, checkpoint: async () => {} } });
    expect(result.state.pendingField).toBe('customer_cpf');
    expect(execute).not.toHaveBeenCalled();
  });

  it('makes configured CRM values available to adaptive reasoning without a model-invented choice', async () => {
    const doc = createDefaultAgentStudioDocument('agent', 'workspace'); doc.resolveStage.procedures = [procedure()];
    const action = (kind: 'tool' | 'respond') => ({ requests: kind === 'tool' ? [{ id: 'request', procedureId: 'sgp', objective: 'Consultar conexão', status: 'active' }] : [], choices: [], action: { kind, requestId: kind === 'tool' ? 'request' : null, capabilityId: kind === 'tool' ? 'sgp:sgp_contracts' : null, query: null, response: kind === 'respond' ? 'Consulta realizada.' : null, consent: 'none', consentQuote: null, reason: '' } });
    const decide = vi.fn().mockResolvedValueOnce(action('tool')).mockResolvedValueOnce(action('respond'));
    const execute = vi.fn().mockResolvedValue({ values: { contracts: [{ id: '1', label: 'Única instalação' }], contracts_count: 1 } });
    await advanceStudioReasoningSession({ document: doc, state: createStudioSession(doc.id, 'release', 'session'), messageId: 'm1', message: 'Consultar conexão', context: { contact: { custom_fields: { sgp_document: '52998224725' } } }, sources: [], memory: { records: [], nextCursor: null }, dependencies: { decide, execute, knowledge: async () => null, handoff: async () => {}, checkpoint: async () => {}, recall: async () => ({ records: [], nextCursor: null }) } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1].values.customer_cpf).toBe('52998224725');
    expect(decide.mock.calls[1][0].requests[0].sensitiveFieldsAvailable).toContain('customer_cpf');
    expect(decide.mock.calls[1][0].requests[0].values.customer_contract).toBe('1');
  });
});
