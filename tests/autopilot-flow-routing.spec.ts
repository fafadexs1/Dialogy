import { describe, expect, it } from 'vitest';

import type { AutopilotConfig } from '@/lib/types';
import {
  formatFlowReferencesForPrompt,
  formatFlowSwitchGuidanceForPrompt,
  formatFlowFormGuidanceForPrompt,
  renderDeterministicFlowMessage,
  resolveActiveFlowIntentScopeByNodeId,
  resolveFirstFlowSwitchRoute,
  resolveFlowSwitchRouteForActivePath,
  resolveFlowSwitchRoute,
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

  it('resolves configured switch routes from customer message evidence', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'switch-wifi',
          kind: 'switch',
          title: 'Tipo de problema Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            instructions: 'Classifique o problema de Wi-Fi do cliente.',
            confidenceThreshold: 0.7,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar nome/senha',
                description: 'Cliente quer trocar nome da rede, senha, SSID ou credenciais do Wi-Fi.',
                examples: ['trocar a senha do Wi-Fi', 'mudar nome da rede'],
                requiredSlots: ['wifi_ssid', 'wifi_password'],
                targetNodeId: 'coletar-wifi',
              },
              {
                id: 'lentidao_wifi',
                label: 'Lentidao no Wi-Fi',
                description: 'Cliente relata lentidao, travamento, oscilacao ou sinal fraco.',
                examples: ['Wi-Fi lento', 'internet travando'],
                targetNodeId: 'diagnosticar-lentidao',
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Use quando nao houver evidencia suficiente.',
                targetNodeId: 'perguntar-melhor',
              },
            ],
          },
        },
        { id: 'coletar-wifi', kind: 'form', title: 'Coletar Wi-Fi', subtitle: 'Dados', position: { x: 200, y: 0 } },
        { id: 'diagnosticar-lentidao', kind: 'understand', title: 'Diagnosticar lentidao', subtitle: 'Suporte', position: { x: 200, y: 140 } },
        { id: 'perguntar-melhor', kind: 'send_message', title: 'Perguntar melhor', subtitle: 'Fallback', position: { x: 200, y: 280 } },
      ],
      edges: [],
    });

    const resolution = resolveFlowSwitchRoute({
      config,
      switchNodeId: 'switch-wifi',
      customerMessage: 'Oi, preciso trocar a senha do Wi-Fi aqui de casa',
    });
    const guidance = formatFlowSwitchGuidanceForPrompt(config);

    expect(resolution).toMatchObject({
      routeId: 'alterar_wifi',
      routeLabel: 'Alterar nome/senha',
      targetNodeId: 'coletar-wifi',
      fallbackUsed: false,
    });
    expect(resolution?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(resolution?.candidateRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        routeId: 'alterar_wifi',
        selected: true,
      }),
      expect.objectContaining({
        routeId: 'lentidao_wifi',
        selected: false,
      }),
    ]));
    expect(resolution?.rejectedRoutes.map((route) => route.routeId)).toEqual(expect.arrayContaining([
      'lentidao_wifi',
      'outro',
    ]));
    expect(guidance).toContain('SWITCHES DO FLUXO');
    expect(guidance).toContain('alterar_wifi');
    expect(resolveFirstFlowSwitchRoute({
      config,
      customerMessage: 'Meu Wi-Fi esta lento e fica travando',
    })).toMatchObject({
      routeId: 'lentidao_wifi',
      targetNodeId: 'diagnosticar-lentidao',
    });
  });

  it('resolves intent scope directly from a target node id', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'suporte-wifi',
          kind: 'intent',
          title: 'Suporte Wi-Fi',
          subtitle: 'Sub-agente',
          position: { x: 0, y: 0 },
          config: {
            intent: 'troubleshooting',
            instructions: 'Conduza diagnosticos de Wi-Fi.',
            knowledgeCollectionIds: ['wifi'],
          },
        },
      ],
      edges: [],
    });

    expect(resolveActiveFlowIntentScopeByNodeId(config, 'suporte-wifi')).toMatchObject({
      nodeId: 'suporte-wifi',
      intent: 'troubleshooting',
      systemPrompt: 'Conduza diagnosticos de Wi-Fi.',
      knowledgeCollectionIds: ['wifi'],
    });
  });

  it('falls back when switch confidence is below threshold', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'switch-wifi',
          kind: 'switch',
          title: 'Tipo de problema Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.9,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar nome/senha',
                description: 'Cliente quer trocar nome da rede ou senha do Wi-Fi.',
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Use quando nao houver evidencia suficiente.',
              },
            ],
          },
        },
      ],
      edges: [],
    });

    expect(resolveFlowSwitchRoute({
      config,
      switchNodeId: 'switch-wifi',
      customerMessage: 'isso ai esta ruim',
    })).toMatchObject({
      routeId: 'outro',
      fallbackUsed: true,
    });
  });

  it('uses route-labeled edges as switch targets when route config has no targetNodeId', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'switch-wifi',
          kind: 'switch',
          title: 'Tipo de problema Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.7,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar nome/senha',
                description: 'Cliente quer trocar nome ou senha do Wi-Fi.',
                examples: ['trocar senha wifi'],
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Use quando nao houver evidencia suficiente.',
              },
            ],
          },
        },
        { id: 'coletar-wifi', kind: 'form', title: 'Coletar Wi-Fi', subtitle: 'Dados', position: { x: 200, y: 0 } },
        { id: 'perguntar-melhor', kind: 'send_message', title: 'Perguntar melhor', subtitle: 'Fallback', position: { x: 200, y: 160 } },
      ],
      edges: [
        { id: 'switch-coletar', source: 'switch-wifi', target: 'coletar-wifi', routeId: 'alterar_wifi' },
        { id: 'switch-fallback', source: 'switch-wifi', target: 'perguntar-melhor', routeId: 'outro' },
      ],
    });

    expect(resolveFlowSwitchRoute({
      config,
      switchNodeId: 'switch-wifi',
      customerMessage: 'preciso trocar senha wifi',
    })).toMatchObject({
      routeId: 'alterar_wifi',
      targetNodeId: 'coletar-wifi',
      fallbackUsed: false,
    });
  });

  it('resolves the nearest switch reachable from the active flow node', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'orphan-switch',
          kind: 'switch',
          title: 'Switch fora do caminho',
          subtitle: 'Nao deve rodar',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.6,
            fallbackRouteId: 'outro',
            routes: [
              { id: 'billing', label: 'Financeiro', description: 'Cliente fala de boleto.', examples: ['boleto'] },
              { id: 'outro', label: 'Outro', description: 'Fallback.' },
            ],
          },
        },
        { id: 'assistant', kind: 'assistant', title: 'Agente', subtitle: 'Principal', position: { x: 0, y: 120 } },
        {
          id: 'wifi-switch',
          kind: 'switch',
          title: 'Switch Wi-Fi',
          subtitle: 'Rota ativa',
          position: { x: 200, y: 120 },
          config: {
            confidenceThreshold: 0.6,
            fallbackRouteId: 'outro',
            routes: [
              { id: 'lentidao_wifi', label: 'Lentidao', description: 'Cliente relata Wi-Fi lento ou travando.', examples: ['wifi lento'], targetNodeId: 'diagnostico' },
              { id: 'outro', label: 'Outro', description: 'Fallback.', targetNodeId: 'fallback' },
            ],
          },
        },
        { id: 'diagnostico', kind: 'intent', title: 'Diagnostico', subtitle: 'Wi-Fi', position: { x: 400, y: 80 }, config: { intent: 'troubleshooting', instructions: 'Diagnosticar Wi-Fi.' } },
        { id: 'fallback', kind: 'send_message', title: 'Perguntar melhor', subtitle: 'Fallback', position: { x: 400, y: 200 } },
      ],
      edges: [
        { id: 'assistant-switch', source: 'assistant', target: 'wifi-switch' },
        { id: 'switch-diagnostico', source: 'wifi-switch', target: 'diagnostico', routeId: 'lentidao_wifi' },
        { id: 'switch-fallback', source: 'wifi-switch', target: 'fallback', routeId: 'outro' },
      ],
    });

    expect(resolveFlowSwitchRouteForActivePath({
      config,
      activeNodeId: 'assistant',
      customerMessage: 'meu wifi lento demais',
    })).toMatchObject({
      switchNodeId: 'wifi-switch',
      routeId: 'lentidao_wifi',
      targetNodeId: 'diagnostico',
    });
  });

  it('re-enters the first switch for a strong new intent but preserves an ambiguous active branch reply', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', title: 'Inicio', subtitle: '', position: { x: 0, y: 0 } },
        {
          id: 'wifi-switch',
          kind: 'decision',
          title: 'Triagem Wi-Fi',
          subtitle: '',
          position: { x: 180, y: 0 },
          config: {
            confidenceThreshold: 0.8,
            fallbackRouteId: 'fallback',
            routes: [
              {
                id: 'consultar_wifi',
                label: 'Consultar Wi-Fi atual',
                description: 'Consultar usuario, senha ou SSID atuais.',
                targetNodeId: 'lookup-collect',
              },
              {
                id: 'diagnosticar_wifi',
                label: 'Diagnosticar Wi-Fi lento',
                description: 'Analisar canais, redes ao redor e interferencia.',
                targetNodeId: 'diagnostic-collect',
              },
              {
                id: 'fallback',
                label: 'Esclarecer',
                description: 'Pedido ambiguo.',
                targetNodeId: 'fallback-message',
              },
            ],
          },
        },
        { id: 'lookup-collect', kind: 'collect', title: 'Validar consulta', subtitle: '', position: { x: 400, y: 0 } },
        { id: 'lookup-response', kind: 'sub_agent', title: 'Responder consulta', subtitle: '', position: { x: 600, y: 0 } },
        { id: 'diagnostic-collect', kind: 'collect', title: 'Validar diagnostico', subtitle: '', position: { x: 400, y: 160 } },
        { id: 'fallback-message', kind: 'message', title: 'Esclarecer', subtitle: '', position: { x: 400, y: 320 } },
      ],
      edges: [
        { id: 'start-switch', source: 'start', target: 'wifi-switch' },
        { id: 'switch-lookup', source: 'wifi-switch', target: 'lookup-collect', routeId: 'consultar_wifi' },
        { id: 'lookup-response', source: 'lookup-collect', target: 'lookup-response' },
      ],
    });

    expect(resolveFlowSwitchRouteForActivePath({
      config,
      activeNodeId: 'lookup-collect',
      customerMessage: 'Agora meu Wi-Fi esta lento. Analise os canais e as redes ao redor.',
    })).toMatchObject({
      routeId: 'diagnosticar_wifi',
      targetNodeId: 'diagnostic-collect',
      fallbackUsed: false,
    });
    expect(resolveFlowSwitchRouteForActivePath({
      config,
      activeNodeId: 'lookup-collect',
      customerMessage: 'Sim, confirmo.',
    })).toBeNull();
  });

  it('routes an explicit Wi-Fi credential lookup above a strict lexical threshold', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        {
          id: 'switch-wifi',
          kind: 'decision',
          title: 'Triagem Wi-Fi',
          subtitle: 'Rotas isoladas',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.8,
            fallbackRouteId: 'fallback',
            routes: [
              {
                id: 'consultar_wifi',
                label: 'Consultar Wi-Fi atual',
                description: 'Cliente pediu usuario, senha, SSID ou credenciais atuais do Wi-Fi.',
                examples: ['Esqueci a senha do Wi-Fi'],
                targetNodeId: 'validar-consulta',
              },
              {
                id: 'trocar_wifi',
                label: 'Trocar nome ou senha',
                description: 'Cliente pediu alteracao de SSID ou senha.',
                examples: ['Quero trocar a senha'],
                targetNodeId: 'validar-troca',
              },
              {
                id: 'fallback',
                label: 'Esclarecer',
                description: 'Pedido ambiguo.',
                targetNodeId: 'esclarecer',
              },
            ],
          },
        },
        { id: 'validar-consulta', kind: 'collect', title: 'Validar consulta', subtitle: '', position: { x: 200, y: 0 } },
        { id: 'validar-troca', kind: 'collect', title: 'Validar troca', subtitle: '', position: { x: 200, y: 120 } },
        { id: 'esclarecer', kind: 'message', title: 'Esclarecer', subtitle: '', position: { x: 200, y: 240 } },
      ],
      edges: [],
    });

    expect(resolveFlowSwitchRoute({
      config,
      switchNodeId: 'switch-wifi',
      customerMessage: 'Esqueci o usuario e a senha do meu Wi-Fi. Meu CPF e 000.000.000-00.',
    })).toMatchObject({
      routeId: 'consultar_wifi',
      targetNodeId: 'validar-consulta',
      confidence: 0.99,
      fallbackUsed: false,
    });
  });

  it('crosses a migrated legacy intent wrapper to reach the explicit downstream switch', () => {
    const config = configWithFlow({
      version: 1,
      nodes: [
        { id: 'start', kind: 'trigger', title: 'Inicio', subtitle: '', position: { x: 0, y: 0 } },
        {
          id: 'wifi-intent',
          kind: 'intent',
          title: 'Atendimento Wi-Fi',
          subtitle: 'Suporte',
          position: { x: 150, y: 0 },
          config: {
            intent: 'troubleshooting',
            instructions: 'Resolva problemas de Wi-Fi seguindo o Switch.',
          },
        },
        {
          id: 'wifi-switch',
          kind: 'switch',
          title: 'Classificar Wi-Fi',
          subtitle: 'Rotas',
          position: { x: 300, y: 0 },
          config: {
            confidenceThreshold: 0.65,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'lentidao_wifi',
                label: 'Lentidao no Wi-Fi',
                description: 'Cliente relata internet lenta, travando ou sinal fraco.',
                examples: ['internet travando', 'wifi lento'],
                targetNodeId: 'diagnostico',
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Fallback seguro.',
                targetNodeId: 'fallback',
              },
            ],
          },
        },
        { id: 'diagnostico', kind: 'send_message', title: 'Diagnostico', subtitle: '', position: { x: 500, y: 0 } },
        { id: 'fallback', kind: 'send_message', title: 'Esclarecer', subtitle: '', position: { x: 500, y: 150 } },
      ],
      edges: [
        { id: 'start-intent', source: 'start', target: 'wifi-intent' },
        { id: 'intent-switch', source: 'wifi-intent', target: 'wifi-switch' },
        { id: 'switch-slow', source: 'wifi-switch', target: 'diagnostico', routeId: 'lentidao_wifi' },
        { id: 'switch-other', source: 'wifi-switch', target: 'fallback', routeId: 'outro' },
      ],
    });

    expect(resolveFlowSwitchRouteForActivePath({
      config,
      customerMessage: 'Minha internet esta travando muito no Wi-Fi',
    })).toMatchObject({
      switchNodeId: 'wifi-switch',
      routeId: 'lentidao_wifi',
      targetNodeId: 'diagnostico',
      fallbackUsed: false,
    });
  });
});
