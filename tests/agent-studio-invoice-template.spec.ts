import { describe, expect, it, vi } from 'vitest';
import { createInvoiceAgentStudioTemplate } from '@/services/agent-studio/types';
import { validateAgentForPublication } from '@/services/agent-studio/assistant-validator';
import { advanceStudioSession, createStudioSession, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import { validateStudioField, extractStudioFieldCandidate } from '@/services/agent-studio/collection';

function fixture(invoices: Array<{ id: number; reference: string }>) {
  const document = createInvoiceAgentStudioTemplate('agent', 'workspace');
  const procedure = document.resolveStage.procedures[0];
  procedure.steps[1].httpRequest!.url = 'https://example.com/invoices';
  const mcp = procedure.steps.find((step) => step.mcpTool)!.mcpTool!; mcp.serverId = 'test'; mcp.qualifiedToolName = 'mcp:test:get_invoice';
  const deps: StudioEngineDependencies = { execute: vi.fn(async (step) => ({ values: step.httpRequest ? { invoices_list: invoices } : { invoice_url: 'https://example.com/invoice.pdf' } })), knowledge: async () => null, handoff: vi.fn(async () => {}) };
  let state = createStudioSession('agent', 'release', 'session'), counter = 0;
  return { document, deps, send: async (message: string) => { const result = await advanceStudioSession({ document, state, message, messageId: String(++counter), dependencies: deps }); state = result.state; return result; } };
}

describe('optional invoice procedure template', () => {
  it.each(['529.982.247-25', '11.222.333/0001-81', '12.ABC.345/01DE-35'])('accepts %s without treating it as proof of identity', (identifier) => {
    const f = fixture([]); const field = f.document.resolveStage.procedures[0].steps[0].collectField!;
    expect(validateStudioField(field, identifier).valid).toBe(true);
    expect(extractStudioFieldCandidate(field, `Quero fatura; documento ${identifier}`, false)).toBe(identifier);
    expect(f.document.resolveStage.procedures[0].whenToUse).toContain('não comprova identidade');
  });
  it('is incomplete until integrations are chosen, then has valid paths and data dependencies', () => {
    expect(validateAgentForPublication(createInvoiceAgentStudioTemplate('agent', 'workspace')).valid).toBe(false);
    const f = fixture([]); expect(validateAgentForPublication(f.document).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
  it('does not generate or claim a document when no invoices are returned', async () => {
    const f = fixture([]); const result = await f.send('fatura 529.982.247-25');
    expect(result.response).toContain('Não encontrei faturas'); expect(result.response).not.toContain('Aqui está o link'); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('selects one invoice automatically but confirms the external operation before delivery', async () => {
    const f = fixture([{ id: 10, reference: 'Maio/2026' }]);
    const first = await f.send('fatura 529.982.247-25'); expect(first.state.values.selected_invoice).toBe(10); expect(first.response).toContain('Posso executar'); expect(f.deps.execute).toHaveBeenCalledOnce();
    const confirmed = await f.send('sim'); expect(confirmed.response).toContain('https://example.com/invoice.pdf'); expect(f.deps.execute).toHaveBeenCalledTimes(2);
    expect((await f.send('sim')).state.status).toBe('resolved');
  });
  it('requires an explicit choice from multiple invoices and preserves the selected numeric identifier', async () => {
    const f = fixture([{ id: 10, reference: 'Maio/2026' }, { id: 11, reference: 'Abril/2026' }]);
    const first = await f.send('fatura 529.982.247-25'); expect(first.response).toContain('1. Maio/2026'); expect(first.response).toContain('2. Abril/2026');
    const selected = await f.send('2'); expect(selected.state.values.selected_invoice).toBe(11); expect(f.deps.execute).toHaveBeenCalledOnce();
    expect((await f.send('sim')).response).toContain('https://example.com/invoice.pdf');
  });
});
