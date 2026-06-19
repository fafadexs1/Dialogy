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
  it('validates a model response composed from retrieved pricing knowledge', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Qual o valor da consulta?',
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      modelResponse: 'A consulta inicial custa R$ 180 e o retorno custa R$ 90.',
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

  it('keeps a procedure response above universal workflow slot prompts when requested', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Prefiro consulta de rotina de tarde. Meu telefone e 5561995215930.',
      chatHistory: [
        'Cliente: Minha filha Ana tem 5 anos, esta com coriza clara e espirrando.',
        'Atendente: Como esta a respiracao?',
        'Cliente: A respiracao esta normal, sem cansaco.',
      ].join('\n'),
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      modelResponse: 'Perfeito. Vamos seguir com o agendamento de consulta eletiva/de rotina. Qual dia fica melhor?',
      preferModelResponse: true,
      contact,
      enabledToolNames: [],
      toolCatalog: listAgentToolCatalogItems(),
      availableTeams: [supportTeam],
    });

    expect(trace.intent.intent).toBe('scheduling_request');
    expect(trace.workflow.executionMode).toBe('direct_response');
    expect(trace.finalResponse).toContain('consulta eletiva');
    expect(trace.finalResponse).not.toContain('me informe data e horario');
  });

  it('repairs pediatric procedure scheduling handoffs using chat history', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Quero um horario amanha cedo. Meu telefone e 5561995215930.',
      chatHistory: [
        'Cliente: Meu filho Davi tem 6 anos, vomitou 3 vezes e esta com diarreia desde cedo.',
        'Cliente: Ele aceita agua em pequenos goles e urinou duas vezes hoje.',
        'Cliente: Nao tem boca seca nem olhos fundos.',
      ].join('\n'),
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      modelResponse: 'Nao consigo consultar isso automaticamente com seguranca agora. Vou encaminhar seu atendimento para a equipe Pediatras.',
      preferModelResponse: true,
      systemAgentName: 'Dra Roberta',
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      toolCatalog: listAgentToolCatalogItems(),
      availableTeams: [supportTeam],
    });

    expect(trace.validator.decision).toBe('repair');
    expect(trace.validator.reasons).toContain('pediatric_scheduling_handoff_repaired');
    expect(trace.finalResponse).toContain('consulta urgente');
    expect(trace.finalResponse).not.toContain('encaminhar seu atendimento');
  });

  it('keeps clinical handoff traces terminal without generic slot prompts', () => {
    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: 'Meu filho Lucas tem 2 anos, esta respirando muito rapido e a costela afunda.',
      knowledgeDocuments: docs,
      fallbackReply: 'Fallback configurado.',
      modelResponse: 'Identifiquei sinais de urgencia. Por favor, procure um pronto-socorro imediatamente ou entre em contato com a equipe de emergencia agora.',
      modelActions: [{ type: 'transfer_chat', reason: 'Risco vermelho', payload: { teamId: supportTeam.id } }],
      preferModelResponse: true,
      systemAgentName: 'Dra Roberta',
      contact,
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      toolCatalog: listAgentToolCatalogItems(),
      availableTeams: [supportTeam],
    });

    expect(trace.validator.reasons).toContain('clinical_handoff_terminal_response');
    expect(trace.finalResponse).toContain('[TRANSFERIR_HUMANO]');
    expect(trace.finalResponse).not.toContain('produto');
    expect(trace.finalResponse).not.toContain('servico');
  });
});
