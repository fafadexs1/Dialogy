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
  systemAgentName?: string;
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
    systemAgentName: input.systemAgentName,
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

  it('repairs deferred pediatric analysis promises with the next triage question', () => {
    const result = validate({
      message: 'A Joaquina tem 6 meses. Ela esta com febre 38.5 desde ontem, prostrada, mamando pouco e teve diarreia hoje.',
      response: 'Entendido, Fabricio. Obrigada por confirmar que a Joaquina tem 6 meses.\n\nComo ela esta com febre desde ontem, apresentando prostracao e uma diarreia hoje, vou realizar agora uma analise mais detalhada do quadro dela para te passar as orientacoes adequadas.',
      plannedActions: [{
        type: 'add_internal_note',
        reason: 'Registro de dados clinicos para triagem',
        payload: {
          content: 'Paciente: Joaquina, 6 meses. Sintomas: febre, prostracao e diarreia.',
        },
      }],
      systemAgentName: 'Dra Roberta',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('deferred_response_promise_repaired');
    expect(result.response).toContain('respiracao da crianca');
    expect(result.response).toContain('?');
    expect(result.response).not.toContain('analise mais detalhada');
  });

  it('repairs deferred generic analysis promises with an operational next step', () => {
    const result = validate({
      message: 'Meu pedido atrasou e queria saber o andamento',
      response: 'Obrigado por avisar. Vou fazer uma analise mais detalhada do seu pedido para te dar um retorno.',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('deferred_response_promise_repaired');
    expect(result.response).toContain('numero do pedido');
    expect(result.response).toContain('?');
  });

  it('allows analysis language when the same response already asks a clear next question', () => {
    const result = validate({
      message: 'A Joaquina tem 6 meses e esta com febre desde ontem',
      response: 'Entendi. Vou avaliar com cuidado e seguir a triagem. A respiracao dela esta normal ou voce percebe cansaco?',
      systemAgentName: 'Dra Roberta',
    });

    expect(result.decision).toBe('approve');
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

  it('keeps clinical red handoff terminal and does not ask generic slots', () => {
    const result = validate({
      message: 'Meu filho Lucas tem 2 anos, esta respirando muito rapido e a costela afunda.',
      response: 'Identifiquei sinais de urgencia. Por favor, procure um pronto-socorro imediatamente ou entre em contato com a equipe de emergencia agora.',
      plannedActions: [{ type: 'transfer_chat', reason: 'Risco vermelho', payload: { teamId: 'team-support' } }],
      systemAgentName: 'Dra Roberta',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('clinical_handoff_terminal_response');
    expect(result.response).toContain('[TRANSFERIR_HUMANO]');
    expect(result.response).toContain('pronto-socorro');
    expect(result.response).not.toContain('produto');
    expect(result.response).not.toContain('servico');
  });

  it('suppresses generic product slot continuation in pediatric triage', () => {
    const result = validateAutopilotResponse({
      response: 'Que bom saber que a Ana esta se alimentando bem e brincando normalmente. Isso e um otimo sinal.',
      fallbackReply: 'Fallback configurado.',
      customerMessage: 'Nao tem febre, esta brincando, comendo e urinando normal.',
      chatHistory: 'Cliente: Minha filha Ana tem 5 anos, esta com coriza clara e espirrando.',
      continuationRequiredSlots: ['product_or_service_preference'],
      intentResolution: resolveAutopilotIntent({ customerMessage: 'Nao tem febre, esta brincando, comendo e urinando normal.' }),
      slotExtraction: extractAutopilotSlots({
        customerMessage: 'Nao tem febre, esta brincando, comendo e urinando normal.',
        chatHistory: 'Cliente: Minha filha Ana tem 5 anos, esta com coriza clara e espirrando.',
        contact,
      }),
      plannedActions: [],
      toolResults: [],
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      availableTeams: [team],
      contact,
      knowledgeCoverage: 'medium',
      source: 'llm',
      systemAgentName: 'Dra Roberta',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('clinical_product_slot_suppressed');
    expect(result.response).toContain('respiracao da crianca');
    expect(result.response).not.toContain('produto');
    expect(result.response).not.toContain('servico');
  });

  it('repairs pediatric blue scheduling handoff into elective scheduling', () => {
    const result = validate({
      message: 'Prefiro consulta de tarde.',
      chatHistory: [
        'Cliente: Minha filha Laura Silva tem 6 anos, tosse leve e sem febre. Meu telefone e 5561995215930.',
        'Atendente: Ha quanto tempo ela esta com tosse?',
        'Cliente: Ela esta bem ativa, comeu e urinou normal.',
      ].join('\n'),
      response: 'Nao consigo consultar isso automaticamente com seguranca agora. Vou encaminhar seu atendimento para a equipe Pediatras.',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('pediatric_scheduling_handoff_repaired');
    expect(result.response).toContain('consulta eletiva/de rotina');
    expect(result.actions).toEqual([]);
  });

  it('repairs pediatric yellow scheduling handoff into urgent scheduling', () => {
    const result = validate({
      message: 'Quero um horario amanha cedo. Meu telefone e 5561995215930.',
      chatHistory: [
        'Cliente: Meu filho Davi tem 6 anos, vomitou 3 vezes e esta com diarreia desde cedo.',
        'Cliente: Ele aceita agua em pequenos goles e urinou duas vezes hoje.',
        'Cliente: Nao tem boca seca nem olhos fundos.',
      ].join('\n'),
      response: 'Vou encaminhar seu atendimento para a equipe Pediatras.',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('pediatric_scheduling_handoff_repaired');
    expect(result.response).toContain('consulta urgente');
    expect(result.actions).toEqual([]);
  });

  it('repairs pediatric scheduling handoff even when the current turn is not classified as scheduling', () => {
    const result = validateAutopilotResponse({
      response: 'Vou encaminhar seu atendimento para a equipe Pediatras.',
      fallbackReply: 'Fallback configurado.',
      customerMessage: 'Tudo bem, pode ser.',
      chatHistory: [
        'Cliente: Meu filho Pedro tem 4 anos e esta com febre 38.8 desde anteontem.',
        'Cliente: Quando a febre baixa ele melhora, bebe agua e fez xixi hoje.',
        'Cliente: Nao esta com falta de ar, mas esta abatido quando a febre sobe.',
        'Cliente: Pode ser hoje no periodo da manha. Telefone 5561995215930.',
      ].join('\n'),
      intentResolution: resolveAutopilotIntent({ customerMessage: 'Tudo bem, pode ser.' }),
      slotExtraction: extractAutopilotSlots({
        customerMessage: 'Tudo bem, pode ser.',
        chatHistory: '',
        contact,
      }),
      plannedActions: [],
      toolResults: [],
      enabledToolNames: ['transfer_chat', 'add_internal_note'],
      availableTeams: [team],
      contact,
      knowledgeCoverage: 'medium',
      source: 'llm',
      systemAgentName: 'Dra Roberta',
    });

    expect(result.decision).toBe('repair');
    expect(result.reasons).toContain('pediatric_scheduling_handoff_repaired');
    expect(result.response).toContain('consulta urgente');
    expect(result.actions).toEqual([]);
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
