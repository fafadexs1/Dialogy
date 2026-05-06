import { describe, expect, it } from 'vitest';

import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { buildAutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import type { Contact, KnowledgeBaseDocument } from '@/lib/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';

const contact: Contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: 'Cliente Teste',
};

const supportTeam: ToolRouterTeam = {
  id: 'team-support',
  name: 'Suporte',
  routingConfig: { enabled: true, autoTransfer: true },
};

const docs: KnowledgeBaseDocument[] = [
  {
    id: 'pricing',
    name: 'Tabela oficial',
    category: 'pricing',
    priority: 10,
    content: 'Consulta inicial: R$ 180. Retorno: R$ 90.',
    canonicalAnswer: 'Consulta inicial: R$ 180. Retorno: R$ 90.',
  },
  {
    id: 'billing',
    name: 'Financeiro',
    category: 'billing',
    content: 'Para segunda via, valide CPF/CNPJ antes de consultar.',
  },
];

describe('autopilot playground trace', () => {
  it('returns a deterministic trace for frontend preview', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Qual o valor da consulta?',
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      toolCatalog: listAgentToolCatalogItems(),
      availableTeams: [supportTeam],
    });

    expect(trace.intent.intent).toBe('pricing_request');
    expect(trace.rag.knowledgeCoverage).toBe('high');
    expect(trace.workflow.executionMode).toBe('continue_llm');
    expect(trace.validator.decision).toBe('approve');
    expect(trace.finalResponse).toContain('R$ 180');
  });

  it('shows planner and validator interventions in the trace', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Preciso da segunda via do boleto',
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      modelResponse: 'Vou consultar sua fatura no sistema.',
      modelActions: [{ type: 'sgp_fetch_contact_panel_data', reason: 'Consultar', payload: {} }],
      contact,
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: listAgentToolCatalogItems(),
      availableTeams: [supportTeam],
    });

    expect(trace.intent.intent).toBe('billing_or_payment');
    expect(trace.toolPlanner.rejectedActions[0]).toMatchObject({ code: 'missing_slots' });
    expect(trace.finalResponse).toContain('CPF/CNPJ');
  });
});
