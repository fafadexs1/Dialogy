import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';

const lookup = vi.hoisted(() => vi.fn());
const saveDocument = vi.hoisted(() => vi.fn());
vi.mock('@/modules/nexus/services/sgp-contact-document', () => ({ saveSgpContactDocumentIfEmpty: saveDocument }));
vi.mock('@/services/agent-tools/sgp-tools', () => ({ lookupSgpCustomerContracts: lookup }));
import { executeSgpIdentification } from '@/modules/nexus/services/sgp-identification';
import { InMemoryWorkflowPersistence, WorkflowExecutor, createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime';
import { workflowNode, workflowDefinition, connect } from './workflow-runtime-fixtures';

function harness(allowNewCustomer = false) {
  const variables: Record<string, unknown> = {};
  const sendOptions = vi.fn().mockResolvedValue({ success: true });
  const sendResponse = vi.fn().mockResolvedValue({ success: true });
  return {
    variables, sendOptions, sendResponse,
    async run(value?: string) {
      const input = { node: { id: 'identify', config: { outputKey: 'identity', allowNewCustomer } },
        workflow: { workspaceId: 'workspace-1' }, execution: { executionId: 'execution-1', conversationId: 'chat-1', variables },
        input: value === undefined ? {} : { resume: { selectedOptionId: value } },
      } as unknown as NodeRuntimeInput;
      const result = await executeSgpIdentification(input, { sendOptions, sendResponse });
      Object.assign(variables, result.statePatch);
      return result;
    },
  };
}
const contracts = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), statusLabel: index === 6 ? 'Cancelado' : 'Ativo', addressLabel: `Rua ${index}`, planDescription: 'Internet' }));

describe('Identification before Velpro handoff', () => {
  beforeEach(() => { lookup.mockReset(); saveDocument.mockReset().mockResolvedValue('saved'); });
  it('paginates every contract without dropping IDs and always offers another CPF', async () => {
    lookup.mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts });
    const h = harness();
    await h.run('1'); // Initial upstream menu answer must never select contract 1.
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const menu = h.sendOptions.mock.calls.at(-1)![0];
      expect(menu.choices.length).toBeLessThanOrEqual(10);
      expect(menu.choices.some((c: any) => c.id === 'other_cpf')).toBe(true);
      seen.push(...menu.choices.filter((c: any) => c.id.startsWith('contract:')).map((c: any) => c.id));
      if (page < 3) await h.run('next');
    }
    expect(seen).toEqual(contracts.map(c => `contract:${c.id}`));
    await h.run('contract:1'); // Not on this page: reject.
    expect(h.variables.identity).toBeUndefined();
    const selected = await h.run('contract:20');
    expect(selected.selectedOutput).toBe('selected');
    expect(h.variables.identity).toMatchObject({ contractId: '20', addressLabel: 'Rua 19' });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it('requires confirmation even for one contract and resolves prefixed ID before numeric index', async () => {
    lookup.mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts: [contracts[0]] });
    const h = harness();
    expect((await h.run()).status).toBe('waiting');
    expect((await h.run('contract:1')).selectedOutput).toBe('selected');
    expect(saveDocument).toHaveBeenCalledWith({ workspaceId: 'workspace-1', chatId: 'chat-1', document: '52998224725' });
  });
  it('validates CNPJ check digits before lookup and saves only after contract selection', async () => {
    lookup.mockResolvedValueOnce({ status: 'missing-identifier' }).mockResolvedValueOnce({ status: 'found', cpfCnpj: '04252011000110', contracts: [contracts[0]] });
    const h = harness(); await h.run(); await h.run('other_cpf');
    await h.run('04.252.011/0001-11');
    expect(lookup).toHaveBeenCalledTimes(1);
    await h.run('04.252.011/0001-10');
    expect(lookup).toHaveBeenLastCalledWith(expect.objectContaining({ customerIdentifier: '04252011000110' }));
    expect(saveDocument).not.toHaveBeenCalled();
    await h.run('contract:1');
    expect(saveDocument).toHaveBeenLastCalledWith(expect.objectContaining({ document: '04252011000110' }));
  });
  it('does not claim success when the CRM write fails', async () => {
    lookup.mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts: [contracts[0]] });
    saveDocument.mockResolvedValue('unavailable');
    const h = harness(); await h.run();
    expect((await h.run('contract:1')).error?.code).toBe('SGP_DOCUMENT_SAVE_FAILED');
  });
  it('replaces only session identity after another CPF, rejecting previous contracts', async () => {
    lookup.mockResolvedValueOnce({ status: 'found', cpfCnpj: '52998224725', contracts: [contracts[0]] })
      .mockResolvedValueOnce({ status: 'found', cpfCnpj: '11144477735', contracts: [contracts[19]] });
    const h = harness();
    await h.run(); await h.run('other_cpf');
    await h.run('invalid');
    expect(lookup).toHaveBeenCalledTimes(1);
    await h.run('111.444.777-35');
    expect(lookup).toHaveBeenLastCalledWith({ workspaceId: 'workspace-1', chatId: 'chat-1', customerIdentifier: '11144477735' });
    expect((await h.run('contract:1')).status).toBe('waiting');
    await h.run('contract:20');
    expect(h.variables.identity).toMatchObject({ cpfCnpj: '11144477735', contractId: '20' });
  });
  it.each(['missing-identifier', 'not-found'])('allows a new Commercial customer for %s', async status => {
    lookup.mockResolvedValue({ status });
    const h = harness(true);
    await h.run();
    expect((await h.run('new_customer')).selectedOutput).toBe('new_customer');
  });
  it('does not offer new customer for Finance and allows going back', async () => {
    lookup.mockResolvedValue({ status: 'not-found' });
    const h = harness(); await h.run();
    expect((await h.run('new_customer')).status).toBe('waiting');
    expect((await h.run('back')).selectedOutput).toBe('cancelled');
  });
  it.each(['new_customer', 'Ainda não sou cliente'])('accepts the Commercial new-customer choice during CPF entry: %s', async answer => {
    lookup.mockResolvedValue({ status: 'missing-identifier' });
    const h = harness(true); await h.run(); await h.run('other_cpf');
    await h.run('invalid');
    expect((await h.run(answer)).selectedOutput).toBe('new_customer');
    expect(h.variables.identity).toMatchObject({ status: 'new_customer', contractId: '' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(saveDocument).not.toHaveBeenCalled();
  });
  it('does not allow the new-customer exit during Finance CPF entry', async () => {
    lookup.mockResolvedValue({ status: 'missing-identifier' });
    const h = harness(false); await h.run(); await h.run('other_cpf');
    expect((await h.run('new_customer')).status).toBe('waiting');
    expect(h.variables.identity).toBeUndefined();
  });
  it('separates provider failure from customer not found and clears a stale selection', async () => {
    lookup.mockResolvedValue({ status: 'unavailable' });
    const h = harness(); h.variables.identity = { contractId: 'stale' };
    const result = await h.run();
    expect(result.selectedOutput).toBe('error');
    expect(h.variables.identity).toMatchObject({ status: 'unavailable', contractId: '' });
    expect(h.sendOptions).not.toHaveBeenCalled();
  });
  it('fails instead of waiting when prompt delivery fails', async () => {
    lookup.mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts });
    const h = harness(); h.sendOptions.mockResolvedValue({ success: false });
    expect((await h.run()).status).toBe('error');
  });
  it.each(['529.982.247-25', 'Voltar', 'Voltar ao menu principal', 'back'])('replaces the previous button with the current typed answer: %s', async answer => {
    lookup.mockResolvedValueOnce({ status: 'missing-identifier' })
      .mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts: [contracts[0]] });
    const trigger = workflowNode('trigger.manual', 'start');
    const identify = workflowNode('dialogy.sgp_identify_customer', 'identify', { outputKey: 'identity' });
    const end = workflowNode('output.end', 'end');
    const graph = workflowDefinition([trigger, identify, end], [
      connect(trigger, 'started', identify, 'main'), connect(identify, 'selected', end, 'main'),
      connect(identify, 'cancelled', end, 'main'),
    ], { workspaceId: 'workspace-1' });
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({
      executePlatformAction: input => executeSgpIdentification(input, { sendResponse: async () => ({ success: true }) }),
    }));
    let execution = await executor.start({ workflow: graph, conversationId: 'chat-1', input: {} });
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: {
      selectedOptionId: 'other_cpf', value: 'Informar CPF/CNPJ', optionResolutionAttempted: true,
    } });
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { value: answer, text: answer } });
    if (answer !== '529.982.247-25') {
      expect(execution.status).toBe('completed');
      expect(execution.variables.identity).toMatchObject({ status: 'cancelled' });
    } else {
      expect(lookup).toHaveBeenLastCalledWith(expect.objectContaining({ customerIdentifier: '52998224725' }));
      execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { selectedOptionId: 'contract:1' } });
      expect(execution.status).toBe('completed');
      expect(execution.variables.identity).toMatchObject({ contractId: '1' });
    }
  });
  it('persists the waiting state and resumes through the real workflow executor', async () => {
    lookup.mockResolvedValue({ status: 'found', cpfCnpj: '52998224725', contracts });
    const trigger = workflowNode('trigger.manual', 'start');
    const identify = workflowNode('dialogy.sgp_identify_customer', 'identify', { outputKey: 'identity' });
    const end = workflowNode('output.end', 'end');
    const recovery = workflowNode('error.handler', 'recovery', { mode: 'recover' });
    const graph = workflowDefinition([trigger, identify, end, recovery], [
      connect(trigger, 'started', identify, 'main'), connect(identify, 'selected', end, 'main'),
      connect(identify, 'new_customer', end, 'main'), connect(identify, 'cancelled', end, 'main'),
      connect(identify, 'error', recovery, 'error', 'error'), connect(recovery, 'recovered', end, 'main'),
    ], { workspaceId: 'workspace-1' });
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({
      executePlatformAction: input => executeSgpIdentification(input, { sendResponse: async () => ({ success: true }) }),
    }));
    let execution = await executor.start({ workflow: graph, conversationId: 'chat-1', input: {} });
    expect(execution.status).toBe('waiting');
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { value: 'next' } });
    expect(execution.status).toBe('waiting');
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { selectedOptionId: 'contract:7' } });
    expect(execution.status, JSON.stringify(execution.failure)).toBe('completed');
    expect(execution.variables.identity).toMatchObject({ contractId: '7', statusLabel: 'Cancelado' });
  });
});
