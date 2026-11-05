import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/agent-tools/runtime', () => ({ runAgentTools: vi.fn() }));
import { runAgentTools } from '@/services/agent-tools/runtime';
import { createAutopilotToolRegistry } from '@/services/workflow-runtime/autopilot-tool-bridge';

const pix = '000201TESTONLY6304ABCD';
const invoice = { id: '8002', contractId: '7001', dueDate: '2026-11-10', isOpen: true, isPaid: false, isCancelled: false, pixCode: pix };
const makeRegistry = (customerMessage = 'Quero o PIX') => createAutopilotToolRegistry({
  context: { workspaceId: 'workspace-1', chat: { id: 'chat-1' }, contact: { id: 'contact-1' }, customerMessage,
    turnPolicy: { allowedToolNames: ['sgp_fetch_contact_panel_data', 'sgp_generate_invoice_pix'] } } as any,
  toolNames: ['sgp_fetch_contact_panel_data', 'sgp_generate_invoice_pix'],
  knownFields: { customer_identifier: '52998224725' },
  definitions: [{ name: 'sgp_generate_invoice_pix', description: 'sgp_generate_invoice_pix',
    riskLevel: 'medium', idempotent: true, timeoutMs: 20_000, maxAttempts: 1,
    requiresHumanApproval: false, inputSchema: {}, outputSchema: {} }],
});
const execute = (registry: ReturnType<typeof makeRegistry>, args: Record<string, unknown>) => registry.executeSafely({
  toolName: 'sgp_generate_invoice_pix', arguments: args,
  execution: { executionId: 'execution-1' } as any, workflow: { id: 'workflow-1' } as any,
  node: { id: 'agent-node' } as any, signal: new AbortController().signal, emit: async () => undefined,
});
const lookup = (invoices = [invoice]) => ({ toolName: 'sgp_fetch_contact_panel_data', status: 'success',
  input: { type: 'sgp_fetch_contact_panel_data' }, output: { invoices } });

describe('native PIX schema, verification and reuse', () => {
  beforeEach(() => vi.mocked(runAgentTools).mockReset());

  it('restores the canonical contract for already-published empty schemas', async () => {
    const registry = makeRegistry();
    expect(registry.get('sgp_generate_invoice_pix')?.inputJsonSchema).toMatchObject({
      required: ['invoiceId', 'contractId'], properties: { invoiceId: { pattern: '^\\d+$' }, contractId: { pattern: '^\\d+$' } },
    });
    expect(registry.get('sgp_generate_invoice_pix')?.description).toContain('pixCode ja existir');
    const result = await execute(registry, {});
    expect(result.record.status).not.toBe('success');
    expect(runAgentTools).not.toHaveBeenCalled();
  });

  it('reuses a fresh SGP PIX and never calls the generating endpoint', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([lookup()] as any);
    const result = await execute(makeRegistry(), { invoiceId: '8002', contractId: '7001' });
    expect(result.output).toMatchObject({ generated: false, reused: true, pixCode: pix });
    expect(runAgentTools).toHaveBeenCalledOnce();
    expect(vi.mocked(runAgentTools).mock.calls[0]?.[1]?.[0]).toMatchObject({
      type: 'sgp_fetch_contact_panel_data', payload: { customerIdentifier: '52998224725' },
    });
  });

  it('generates only after verifying the open invoice when the current consultation has no PIX', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([lookup([{ ...invoice, pixCode: '' }])] as any)
      .mockResolvedValueOnce([{ toolName: 'sgp_generate_invoice_pix', status: 'success',
        input: { type: 'sgp_generate_invoice_pix' }, output: { payload: { codigoPix: pix } } }] as any);
    const result = await execute(makeRegistry(), { invoiceId: '8002', contractId: '7001' });
    expect(result.record.status).toBe('success');
    expect(runAgentTools).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runAgentTools).mock.calls[1]?.[1]?.[0]).toMatchObject({
      type: 'sgp_generate_invoice_pix', payload: { invoiceId: '8002', contractId: '7001' },
    });
  });

  it('asks for clarification instead of allowing the model to silently choose between invoices', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([lookup([invoice, { ...invoice, id: '8003' }])] as any);
    const result = await execute(makeRegistry(), { invoiceId: '8002', contractId: '7001' });
    expect(result.output).toMatchObject({ generated: false, requiresClarification: true });
    expect(runAgentTools).toHaveBeenCalledOnce();
  });

  it.each([{ invoiceId: '9999', contractId: '7001' }, { invoiceId: '8002', contractId: '9999' }])
    ('rejects an invoice/contract inconsistent with the customer consultation: %o', async (args) => {
      vi.mocked(runAgentTools).mockResolvedValueOnce([lookup()] as any);
      const result = await execute(makeRegistry(), args);
      expect(result.output).toMatchObject({ generated: false, requiresClarification: true });
      expect(runAgentTools).toHaveBeenCalledOnce();
    });

  it('never generates for a paid invoice even if old payment codes remain in its record', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([lookup([{ ...invoice, isOpen: false, isPaid: true }])] as any);
    const result = await execute(makeRegistry('PIX da fatura 8002'), { invoiceId: '8002', contractId: '7001' });
    expect(result.output).toMatchObject({ generated: false, payable: false });
    expect(result.output).not.toHaveProperty('pixCode');
    expect(runAgentTools).toHaveBeenCalledOnce();
  });

  it('does not generate when the read dependency fails', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([{ toolName: 'sgp_fetch_contact_panel_data', status: 'error', error: 'offline' }] as any);
    const result = await execute(makeRegistry(), { invoiceId: '8002', contractId: '7001' });
    expect(result.record.status).not.toBe('success');
    expect(runAgentTools).toHaveBeenCalledOnce();
  });
});
