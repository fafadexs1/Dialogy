import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import { validateAutopilotResponse } from '@/services/autopilot/response-validator';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { Contact, KnowledgeBaseDocument } from '@/lib/types';

const team: ToolRouterTeam = {
  id: 'team-support',
  name: 'Suporte',
  routingConfig: { enabled: true, autoTransfer: true },
};

const contact: Contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: 'Cliente Teste',
};

function validate(input: {
  message: string;
  response: string | null;
  chatHistory?: string;
  continuationRequiredSlots?: any[];
  completionActions?: AgentToolAction[];
  plannedActions?: AgentToolAction[];
  toolResults?: AgentToolExecutionResult[];
  enabledToolNames?: string[];
  contactOverride?: Contact;
  knowledgeDocuments?: KnowledgeBaseDocument[];
}) {
  const resolvedContact = input.contactOverride || contact;
  const intentResolution = resolveAutopilotIntent({ customerMessage: input.message });
  return validateAutopilotResponse({
    response: input.response,
    fallbackReply: 'Fallback configurado.',
    customerMessage: input.message,
    chatHistory: input.chatHistory,
    continuationRequiredSlots: input.continuationRequiredSlots as any,
    completionActions: input.completionActions,
    intentResolution,
    slotExtraction: extractAutopilotSlots({
      customerMessage: input.message,
      chatHistory: input.chatHistory,
      contact: resolvedContact,
    }),
    plannedActions: input.plannedActions || [],
    toolResults: input.toolResults || [],
    enabledToolNames: input.enabledToolNames || ['transfer_chat', 'add_internal_note'],
    availableTeams: [team],
    contact: resolvedContact,
    knowledgeCoverage: 'medium',
    knowledgeDocuments: input.knowledgeDocuments,
    source: 'llm',
  });
}

describe('autopilot response validator', () => {
  it('approves a normal safe response', () => {
    const result = validate({
      message: 'Quero conhecer os servicos',
      response: 'Temos algumas opcoes. Qual tipo de servico voce procura?',
    });

    expect(result.decision).toBe('approve');
    expect(result.response).toContain('opcoes');
  });

  it('rejects prices invented outside the factual retrieved documents', () => {
    const result = validate({
      message: 'Preciso do documento do contrato',
      response: 'A taxa do documento e R$79,90.',
      knowledgeDocuments: [{
        id: 'contract-policy',
        name: 'Politica de documentos',
        content: 'A taxa do documento e R$99,90.',
        contextRole: 'fact',
      }],
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.reasons).toContain('unsupported_knowledge_facts');
    expect(result.metadata.unsupportedFacts).toContain('R$79,90');
  });

  it('does not fact-check commercial catalog responses against truncated prompt documents', () => {
    const result = validate({
      message: 'Quais planos voces possuem?',
      response: 'Temos 500 MEGA por R$99,90 e 1000 MEGA por R$149,90.',
      knowledgeDocuments: [{
        id: 'plans',
        name: 'Catalogo de planos',
        content: '500 MEGA por R$99,90.',
        contextRole: 'fact',
      }],
    });

    expect(result.decision).toBe('approve');
  });

  it('approves factual values present in retrieved documents', () => {
    const result = validate({
      message: 'Quais planos voces possuem?',
      response: 'Temos o plano 500 MEGA por R$99,90.',
      knowledgeDocuments: [{
        id: 'plans',
        name: 'Catalogo de planos',
        content: '500 MEGA por R$99,90.',
        contextRole: 'fact',
      }],
    });

    expect(result.decision).toBe('approve');
  });

  it('replaces empty responses with configured fallback', () => {
    const result = validate({
      message: 'Oi',
      response: '',
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.response).toBe('Fallback configurado.');
  });

  it('replaces internal JSON/tool leaks with fallback', () => {
    const result = validate({
      message: 'Preciso de suporte',
      response: '{"response":"ok","actions":[{"type":"sgp_fetch_contact_panel_data","payload":{}}]}',
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.reasons).toContain('internal_or_technical_leak');
  });

  it('replaces leaked conversation transcripts with fallback', () => {
    const result = validate({
      message: 'Pode me mandar as faturas?',
      response: 'Cliente: Ola Cliente: Quanto ta os plano? Atendente: Temos planos. Cliente: Tem no meu bairro? Atendente: Sim, atendemos.',
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.reasons).toContain('conversation_transcript_leak');
  });

  it('asks for CPF/CNPJ when response promises lookup but required slot is missing', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto',
      response: 'Vou consultar sua fatura no sistema.',
    });

    expect(result.decision).toBe('repair');
    expect(result.response).toContain('CPF/CNPJ');
  });

  it('does not ask for CPF/CNPJ again after a successful lookup', () => {
    const result = validate({
      message: 'minha internet esta caindo',
      response: 'Para verificar sua conexao, me passe seu CPF ou CNPJ.',
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: { contracts: [{ id: 'contract-1', connectionStatus: 'online' }] },
        },
      ],
    });

    expect(result.decision).toBe('repair');
    expect(result.response).toContain('Ja localizei os dados necessarios');
    expect(result.response).not.toContain('CPF');
  });

  it('handoffs when response promises lookup without tool or missing slot path', () => {
    const result = validate({
      message: 'Voce consegue verificar disponibilidade?',
      response: 'Vou verificar a disponibilidade no sistema.',
    });

    expect(result.decision).toBe('handoff');
    expect(result.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('approves lookup success claim when a lookup tool succeeded', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      response: 'Consultei o cadastro no sistema e encontrei uma fatura em aberto.',
      plannedActions: [{ type: 'sgp_fetch_contact_panel_data', reason: 'Consulta', payload: {} }],
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: { invoices: [{ id: '1' }] },
        },
      ],
    });

    expect(result.decision).toBe('approve');
  });

  it('repairs generic billing summaries when the customer asked for a payment artifact', () => {
    const result = validate({
      message: 'Pode me informar o PIX dessas duas faturas em aberto?',
      response: 'Consultei o cadastro no sistema e encontrei 2 faturas em aberto.',
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'success',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          output: {
            invoices: [
              {
                id: '886081',
                isOpen: true,
                isPaid: false,
                amount: 54.95,
                dueDate: '2026-06-10',
                pixCode: 'PIX_886081',
              },
              {
                id: '886082',
                isOpen: true,
                isPaid: false,
                amount: 54.95,
                dueDate: '2026-07-10',
                pixCode: 'PIX_886082',
              },
            ],
          },
        },
      ],
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('payment_artifact_missing_from_response');
    expect(result.response).toContain('PIX copia e cola: PIX_886081');
    expect(result.response).toContain('PIX copia e cola: PIX_886082');
  });

  it('replaces lookup success claim when the lookup tool failed', () => {
    const result = validate({
      message: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
      response: 'Consultei o cadastro no sistema e encontrei uma fatura em aberto.',
      plannedActions: [{ type: 'sgp_fetch_contact_panel_data', reason: 'Consulta', payload: {} }],
      toolResults: [
        {
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'error',
          input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
          error: 'timeout',
        },
      ],
    });

    expect(result.decision).toBe('replace_with_fallback');
    expect(result.response).toContain('Nao consegui concluir a consulta');
  });

  it('adds handoff action when response promises transfer without transfer action', () => {
    const result = validate({
      message: 'Estou com problema no acesso',
      response: 'Vou encaminhar para a equipe responsavel.',
    });

    expect(result.decision).toBe('handoff');
    expect(result.actions.map((action) => action.type)).toEqual(['add_internal_note', 'transfer_chat']);
  });

  it('does not auto-transfer self-service when the customer did not ask for a human', () => {
    const result = validate({
      message: 'Tenho interesse em contratar esse servico',
      response: 'Vou encaminhar seu atendimento para a equipe Comercial.',
    });

    expect(result.decision).toBe('repair');
    expect(result.actions).toEqual([]);
    expect(result.reasons).toContain('self_service_transfer_promise_suppressed');
    expect(result.response).toContain('seguir com seu atendimento por aqui');
  });

  it('repairs intake acknowledgements that do not ask the next required slot', () => {
    const result = validate({
      message: '529.982.247-25',
      chatHistory: [
        'Cliente: Quero agendar manutencao preventiva.',
        'Atendente: Qual servico voce deseja?',
        'Cliente: Ta certo, quero agendar manutencao preventiva.',
        'Atendente: Podemos comecar com o seu nome completo?',
        'Cliente: Meu nome completo e Fabricio de Sousa Soares',
      ].join('\n'),
      response: 'Obrigado por confirmar o seu documento! Assim, eu consigo continuar o atendimento com seguranca.',
      contactOverride: {
        ...contact,
        name: '',
        phone: '',
        phone_number_jid: '',
      } as Contact,
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('turn_continuation_repaired');
    expect(result.response).toContain('endereco ou localidade completa');
  });

  it('uses the current WhatsApp as phone and repairs completion acknowledgements', () => {
    const result = validate({
      message: 'Meu telefone e o mesmo que estou falando contigo',
      chatHistory: [
        'Cliente: Quero agendar manutencao preventiva.',
        'Cliente: Meu nome completo e Fabricio de Sousa Soares',
        'Cliente: CPF 529.982.247-25',
        'Cliente: Quadra 12, Lote 13, Morada das Garcas, Cidade Ocidental',
      ].join('\n'),
      response: 'Certo! Como voce esta usando este WhatsApp para conversar comigo, ja tenho seu numero de contato registrado.',
      contactOverride: {
        ...contact,
        phone: '5561995215930',
        phone_number_jid: '5561995215930@s.whatsapp.net',
      } as Contact,
    });

    expect(result.decision).toBe('repair');
    expect(result.response).toContain('Vou registrar as informacoes');
  });

  it('repairs generic workflow acknowledgements using required missing slots', () => {
    const result = validate({
      message: 'Pode ser amanha',
      response: 'Perfeito, data anotada.',
      continuationRequiredSlots: ['time'],
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('turn_continuation_repaired');
    expect(result.response).toContain('Qual horario voce prefere?');
  });

  it('adds flow completion actions after all generic intake slots are collected', () => {
    const closeAction: AgentToolAction = {
      type: 'close_chat',
      reason: 'Fluxo concluiu e solicitou encerramento.',
      payload: { sendCloseMessage: false },
    };
    const result = validate({
      message: 'Obrigado',
      chatHistory: [
        'Cliente: Quero agendar manutencao preventiva.',
        'Cliente: Meu nome completo e Fabricio de Sousa Soares',
        'Cliente: CPF 529.982.247-25',
        'Cliente: Quadra 12, Lote 13, Morada das Garcas, Cidade Ocidental',
        'Cliente: Meu telefone e o mesmo que estou falando contigo',
      ].join('\n'),
      response: 'Obrigado por fornecer esses dados! Ja registrei suas informacoes para darmos continuidade.',
      contactOverride: {
        ...contact,
        phone: '5561995215930',
        phone_number_jid: '5561995215930@s.whatsapp.net',
      } as Contact,
      completionActions: [closeAction],
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('flow_completion_actions_added');
    expect(result.actions).toEqual([closeAction]);
  });

  it('adds close_chat action when response promises closure without action', () => {
    const result = validate({
      message: 'pode encerrar o atendimento',
      response: 'Atendimento encerrado conforme solicitado.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(result.decision).toBe('repair');
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
    expect((result.actions[0] as any).payload.sendCloseMessage).toBe(false);
  });

  it('repairs first-person closure claims without close action', () => {
    const result = validate({
      message: 'Encerra ai',
      response: 'Compreendido, Fabricio. Finalizei o atendimento por aqui, conforme solicitado.',
      enabledToolNames: ['close_chat', 'add_internal_note'],
    });

    expect(result.decision).toBe('repair');
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
  });
});
