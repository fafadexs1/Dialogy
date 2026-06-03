import { describe, expect, it } from 'vitest';

import type { AutopilotConfig } from '@/lib/types';
import {
  formatFlowReferencesForPrompt,
  formatFlowFormGuidanceForPrompt,
  renderDeterministicFlowMessage,
  resolveActiveFlowIntentScope,
  resolveDeterministicFlowMessage,
  resolveEntryDeterministicFlowMessage,
  resolveFlowCompletionPlan,
  resolveFlowFormGuidance,
} from '@/services/autopilot/flow-routing';

function configWithFlow(flowGraph: AutopilotConfig['flow_graph']): AutopilotConfig {
  return {
    id: 'agent-1',
    workspace_id: 'workspace-1',
    user_id: 'user-1',
    name: 'Agente',
    gemini_api_key: null,
    ai_model: null,
    transcription_model: null,
    knowledge_base: null,
    knowledge_base_documents: [],
    is_primary: true,
    is_active: true,
    is_private: false,
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    default_fallback_reply: null,
    escalation_policy: null,
    closing_policy: null,
    enabled_tool_names: [],
    flow_graph: flowGraph,
  } as AutopilotConfig;
}

describe('autopilot flow routing', () => {
  it('resolves fixed messages connected directly to the incoming trigger', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'incoming',
          kind: 'trigger',
          title: 'Mensagem recebida',
          subtitle: 'Inicio do atendimento',
          position: { x: 0, y: 0 },
        },
        {
          id: 'message',
          kind: 'send_message',
          title: 'Enviar mensagem',
          subtitle: 'Sem IA',
          position: { x: 0, y: 100 },
          config: {
            message: 'Ola, vou iniciar seu atendimento.',
          },
        },
        {
          id: 'understand',
          kind: 'understand',
          title: 'Entender cliente',
          subtitle: 'Intencao e dados',
          position: { x: 0, y: 200 },
        },
      ],
      edges: [
        { id: 'incoming-message', source: 'incoming', target: 'message' },
        { id: 'message-understand', source: 'message', target: 'understand' },
      ],
    });

    expect(resolveEntryDeterministicFlowMessage(config)).toEqual({
      nodeId: 'message',
      title: 'Enviar mensagem',
      message: 'Ola, vou iniciar seu atendimento.',
    });
  });

  it('renders deterministic form nodes as fixed WhatsApp data collection messages', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'incoming',
          kind: 'trigger',
          title: 'Mensagem recebida',
          subtitle: 'Inicio',
          position: { x: 0, y: 0 },
        },
        {
          id: 'purchase',
          kind: 'intent',
          title: 'Compra',
          subtitle: 'Contratacao',
          position: { x: 100, y: 0 },
          config: {
            intent: 'purchase_inquiry',
            instructions: 'Conduza a contratacao.',
          },
        },
        {
          id: 'form',
          kind: 'form',
          title: 'Dados para contrato',
          subtitle: 'Formulario',
          position: { x: 200, y: 0 },
          config: {
            message: 'Para contratar, me envie:',
            formFields: [
              { id: 'name', label: 'Nome completo', required: true },
              { id: 'address', label: 'Endereco de instalacao', required: true, placeholder: 'Rua, numero, bairro' },
              { id: 'reference', label: 'Ponto de referencia', required: false },
            ],
          },
        },
      ],
      edges: [
        { id: 'incoming-purchase', source: 'incoming', target: 'purchase' },
        { id: 'purchase-form', source: 'purchase', target: 'form' },
      ],
    });

    const scope = resolveActiveFlowIntentScope(config, 'purchase_inquiry');
    const deterministicMessage = resolveDeterministicFlowMessage(config, scope);
    const rendered = renderDeterministicFlowMessage(config, deterministicMessage?.message || '', {
      customerMessage: 'Quero contratar',
      contactName: 'Cliente',
    });

    expect(deterministicMessage?.title).toBe('Dados para contrato');
    expect(rendered).toContain('Para contratar, me envie:');
    expect(rendered).toContain('Nome completo (obrigatorio)');
    expect(rendered).toContain('Endereco de instalacao (obrigatorio). Ex.: Rua, numero, bairro');
    expect(rendered).toContain('Ponto de referencia (opcional)');
    expect(rendered).toContain('Pode responder tudo em uma unica mensagem.');
  });

  it('exposes AI-guided form nodes as prompt guidance instead of deterministic messages', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'incoming',
          kind: 'trigger',
          title: 'Mensagem recebida',
          subtitle: 'Inicio',
          position: { x: 0, y: 0 },
        },
        {
          id: 'purchase',
          kind: 'intent',
          title: 'Compra',
          subtitle: 'Contratacao',
          position: { x: 100, y: 0 },
          config: {
            intent: 'purchase_inquiry',
            instructions: 'Conduza a contratacao.',
          },
        },
        {
          id: 'form',
          kind: 'form',
          title: 'Dados para contrato',
          subtitle: 'Formulario',
          position: { x: 200, y: 0 },
          config: {
            formMode: 'ai',
            message: 'Colete os dados para instalacao.',
            formFields: [
              { id: 'name', label: 'Nome completo', fieldKey: 'nome_completo', required: true },
              { id: 'address', label: 'Endereco de instalacao', fieldKey: 'endereco_instalacao', required: true },
            ],
          },
        },
      ],
      edges: [
        { id: 'incoming-purchase', source: 'incoming', target: 'purchase' },
        { id: 'purchase-form', source: 'purchase', target: 'form' },
      ],
    });

    const scope = resolveActiveFlowIntentScope(config, 'purchase_inquiry');
    expect(resolveDeterministicFlowMessage(config, scope)).toBeNull();

    const guidance = resolveFlowFormGuidance(config, scope);
    const prompt = formatFlowFormGuidanceForPrompt(guidance);

    expect(guidance?.title).toBe('Dados para contrato');
    expect(prompt).toContain('FORMULARIO GUIADO POR IA ATIVO');
    expect(prompt).toContain('Nome completo');
    expect(prompt).toContain('Pergunte no maximo 1 ou 2 campos por mensagem');
    expect(prompt).toContain('Se o cliente tirar uma duvida no meio');
  });

  it('formats block and skill @ID references for the AI prompt', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'assistant',
          kind: 'assistant',
          title: 'Agente principal',
          subtitle: 'Responder',
          position: { x: 0, y: 0 },
          config: {
            referenceId: 'agente_principal',
            variableName: 'resposta_ia',
          },
        },
      ],
      edges: [],
    });

    const prompt = formatFlowReferencesForPrompt(config, [{
      id: 'rule-1',
      name: 'Coletar contrato',
      trigger: 'Quando cliente quiser contratar',
      action: { type: 'reply', payload: { message: 'ok' } } as any,
      enabled: true,
    }]);

    expect(prompt).toContain('@agente_principal');
    expect(prompt).toContain('bloco "Agente principal"');
    expect(prompt).toContain('@habilidade_coletar_contrato');
    expect(prompt).toContain('habilidade "Coletar contrato"');
  });

  it('resolves close_chat as a flow completion action from a reachable final block', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'assistant',
          kind: 'assistant',
          title: 'Agente principal',
          subtitle: 'Responder com IA',
          position: { x: 0, y: 0 },
        },
        {
          id: 'collect',
          kind: 'understand',
          title: 'Coletar dados',
          subtitle: 'Entender dados',
          position: { x: 100, y: 0 },
        },
        {
          id: 'end',
          kind: 'trigger',
          title: 'Fim do fluxo',
          subtitle: 'Encerrar',
          position: { x: 200, y: 0 },
          config: {
            instructions: 'Finalize o atendimento e utilize @close_chat depois de concluir a coleta.',
          },
        },
      ],
      edges: [
        { id: 'assistant-collect', source: 'assistant', target: 'collect' },
        { id: 'collect-end', source: 'collect', target: 'end' },
      ],
    });
    config.enabled_tool_names = ['close_chat'];

    const plan = resolveFlowCompletionPlan(config, 'assistant');

    expect(plan?.reason).toBe('flow_completion_requests_close_chat');
    expect(plan?.terminalNodeId).toBe('end');
    expect(plan?.actions.map((action) => action.type)).toEqual(['close_chat']);
  });
});
