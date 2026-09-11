import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowExecutor, InMemoryWorkflowPersistence, createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { executeSgpIdentification } from '@/modules/nexus/services/sgp-identification';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('@/services/agent-tools/sgp-tools', () => ({ lookupSgpCustomerContracts: lookup }));
vi.mock('@/modules/nexus/services/sgp-contact-document', () => ({ saveSgpContactDocumentIfEmpty: async () => 'preserved' }));

describe('Velpro support routing through the actual upgraded graph and executor', () => {
  it.each(['active', 'suspended', 'cancelled', 'unknown', 'unavailable'])('routes %s without selecting another contract', async status => {
    const flow = WorkflowDefinitionSchema.parse(JSON.parse(readFileSync('docs/velpro-identification-draft.json', 'utf8')));
    const contracts = ['active', 'suspended', 'cancelled', 'unknown'].map((statusTone, index) => ({
      id: String(101 + index), statusTone, statusLabel: statusTone, addressLabel: `Endereço ${index}`, planDescription: 'Internet',
    }));
    lookup.mockReset().mockResolvedValue(status === 'unavailable' ? { status: 'unavailable' } : { status: 'found', cpfCnpj: '52998224725', contracts });
    const handoffs: Array<{ id: string; teamId: unknown; contractId: unknown }> = [];
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({
      sendResponse: async () => ({ success: true }),
      executePlatformAction: async input => input.node.type === 'dialogy.sgp_identify_customer'
        ? executeSgpIdentification(input, { sendResponse: async () => ({ success: true }) })
        : { status: 'route', selectedOutput: input.node.type === 'dialogy.team_availability' ? 'open' : 'success', output: {} },
      handoff: async input => {
        handoffs.push({ id: input.node.id, teamId: input.node.config.teamId, contractId: (input.execution.variables.sgpIdentification as any)?.contractId });
        return { success: true };
      },
    }));
    let execution = await executor.start({ workflow: flow, conversationId: 'isolated-chat', input: { message: 'Olá' } });
    expect(execution.currentNodeId).toBe('velpro_main_menu');
    execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { selectedOptionId: 'support', value: 'support' } });
    if (status !== 'unavailable') {
      expect(execution.currentNodeId).toBe('velpro_support_identify');
      const contract = contracts.find(c => c.statusTone === status)!;
      execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { selectedOptionId: `contract:${contract.id}` } });
    }
    if (status === 'suspended' || status === 'cancelled') {
      expect(execution.status, JSON.stringify(execution.failure)).toBe('completed');
      expect(handoffs[0]?.id).toBe('velpro_finance_handoff');
      expect(handoffs[0]?.contractId).toBe(status === 'suspended' ? '102' : '103');
      expect(execution.executionPath.some(step => step.nodeId === 'velpro_finance_identify')).toBe(false);
      expect(execution.executionPath.some(step => step.nodeId === 'velpro_support_menu')).toBe(false);
    } else {
      expect(execution.currentNodeId, JSON.stringify(execution.failure)).toBe('velpro_support_menu');
      execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { value: 'signal_problem', selectedOptionId: 'signal_problem' } });
      expect(execution.status, JSON.stringify(execution.failure)).toBe('completed');
      expect(handoffs[0]?.id).toBe('velpro_support_handoff');
    }
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(handoffs).toHaveLength(1);
  });
});
