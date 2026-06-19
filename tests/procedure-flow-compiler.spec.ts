import { describe, expect, it, vi } from 'vitest';

import type { AutopilotFlowGraph } from '@/lib/types';
import { compileProcedureFromFlowGraph } from '@/services/autopilot/procedure-flow-compiler';
import { advanceProcedure } from '@/services/autopilot/procedure-executor';
import type { ProcedureExecutionContext, ProcedureGraph } from '@/services/autopilot/procedure-types';

vi.mock('@/services/autopilot/procedure-store', () => ({
  saveProcedureExecution: vi.fn(async () => undefined),
}));

function contextFor(graph: ProcedureGraph): ProcedureExecutionContext {
  return {
    id: 'exec-visual-flow',
    chatId: 'chat-visual-flow',
    workspaceId: 'workspace-visual-flow',
    systemAgentId: 'agent-visual-flow',
    procedureId: graph.id,
    procedureName: graph.documentName,
    currentStepId: graph.steps[0].id,
    status: 'running',
    collectedSlots: {},
    toolResults: {},
    decisions: {},
    retryCount: {},
    startedAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
    stepHistory: [],
  };
}

function visualWifiFlow(): AutopilotFlowGraph {
  return {
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
        id: 'wifi-intent',
        kind: 'intent',
        title: 'Atendimento Wi-Fi',
        subtitle: 'Suporte',
        position: { x: 160, y: 0 },
        config: {
          intent: 'troubleshooting',
          instructions: 'Resolver pedidos de Wi-Fi.',
        },
      },
      {
        id: 'wifi-switch',
        kind: 'switch',
        title: 'Classificar problema Wi-Fi',
        subtitle: 'Rotas',
        position: { x: 320, y: 0 },
        config: {
          instructions: 'Escolha a rota correta para o problema de Wi-Fi.',
          routes: [
            {
              id: 'alterar_wifi',
              label: 'Alterar nome e senha do Wi-Fi',
              description: 'Cliente quer trocar SSID ou senha do roteador.',
              examples: ['trocar senha do wifi', 'mudar nome da rede'],
              intent: 'troubleshooting',
            },
            {
              id: 'lentidao_wifi',
              label: 'Lentidao no Wi-Fi',
              description: 'Cliente relata internet lenta ou oscilando.',
              examples: ['wifi lento'],
              intent: 'troubleshooting',
            },
          ],
        },
      },
      {
        id: 'collect-wifi',
        kind: 'form',
        title: 'Coletar novos dados',
        subtitle: 'Formulario',
        position: { x: 520, y: -80 },
        config: {
          formMode: 'ai',
          message: 'Para alterar o Wi-Fi, me envie:',
          formFields: [
            { id: 'wifi_name', label: 'Novo nome da rede', required: true },
            { id: 'wifi_password', label: 'Nova senha', required: true },
          ],
        },
      },
      {
        id: 'update-router',
        kind: 'tool',
        title: 'Atualizar roteador',
        subtitle: 'MCP',
        position: { x: 720, y: -80 },
        toolName: 'mcp:router:update_wifi_credentials',
      },
      {
        id: 'done-message',
        kind: 'send_message',
        title: 'Confirmar alteracao',
        subtitle: 'Resposta',
        position: { x: 920, y: -80 },
        config: {
          message: 'Pronto, dados do Wi-Fi atualizados.',
        },
      },
      {
        id: 'diagnose',
        kind: 'send_message',
        title: 'Diagnosticar lentidao',
        subtitle: 'Resposta',
        position: { x: 520, y: 120 },
        config: {
          message: 'Vou iniciar o diagnostico de lentidao no Wi-Fi.',
        },
      },
    ],
    edges: [
      { id: 'incoming-intent', source: 'incoming', target: 'wifi-intent' },
      { id: 'intent-switch', source: 'wifi-intent', target: 'wifi-switch' },
      { id: 'switch-form', source: 'wifi-switch', target: 'collect-wifi', routeId: 'alterar_wifi' },
      { id: 'form-tool', source: 'collect-wifi', target: 'update-router' },
      { id: 'tool-done', source: 'update-router', target: 'done-message' },
      { id: 'switch-diagnose', source: 'wifi-switch', target: 'diagnose', routeId: 'lentidao_wifi' },
    ],
  };
}

describe('procedure flow compiler', () => {
  it('maps visual nodes to executable procedure steps with branch targets', () => {
    const result = compileProcedureFromFlowGraph({
      flowGraph: visualWifiFlow(),
      configId: 'agent-wifi',
      name: 'Fluxo visual Wi-Fi',
    });

    expect(result.success).toBe(true);
    const graph = result.graph!;
    expect(graph.triggerIntents).toContain('troubleshooting');
    expect(graph.metadata.visualNodeMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        visualNodeId: 'wifi-switch',
        stepType: 'decide',
      }),
      expect.objectContaining({
        visualNodeId: 'collect-wifi',
        stepType: 'gather_data',
      }),
      expect.objectContaining({
        visualNodeId: 'update-router',
        stepType: 'tool_call',
      }),
    ]));

    const switchStep = graph.steps.find((step) => step.visualNodeId === 'wifi-switch');
    const formStep = graph.steps.find((step) => step.visualNodeId === 'collect-wifi');
    const diagnoseStep = graph.steps.find((step) => step.visualNodeId === 'diagnose');

    expect(switchStep?.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ nextStepId: formStep?.id }),
      expect.objectContaining({ nextStepId: diagnoseStep?.id }),
    ]));
    expect(formStep?.requiredSlots).toEqual(['wifi_name', 'wifi_password']);
  });

  it('runs the compiled visual switch path through the procedure executor', async () => {
    const compiled = compileProcedureFromFlowGraph({
      flowGraph: visualWifiFlow(),
      configId: 'agent-wifi',
      name: 'Fluxo visual Wi-Fi',
    }).graph!;
    const runtimeContext = contextFor(compiled);

    const result = await advanceProcedure({
      graph: compiled,
      context: runtimeContext,
      customerMessage: 'Quero alterar o nome e a senha do Wi-Fi',
      decisionResolver: async () => 'Alterar nome e senha do Wi-Fi',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.executedSteps).toEqual([
      compiled.steps.find((step) => step.visualNodeId === 'wifi-intent')?.id,
      compiled.steps.find((step) => step.visualNodeId === 'wifi-switch')?.id,
      compiled.steps.find((step) => step.visualNodeId === 'collect-wifi')?.id,
    ]);
    expect(result.response?.toLowerCase()).toContain('novo nome da rede');
    expect(runtimeContext.currentStepId).toBe(
      compiled.steps.find((step) => step.visualNodeId === 'collect-wifi')?.id
    );
  });

  it('routes decision branches through lateral knowledge before grounded sub-agents', async () => {
    const flowGraph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'triage',
          kind: 'decision',
          title: 'Triagem comercial',
          subtitle: 'Rotas',
          position: { x: 0, y: 0 },
          config: {
            routes: [
              {
                id: 'duvida',
                label: 'Duvida sobre Planos',
                description: 'Cliente quer detalhes tecnicos sobre planos.',
                examples: ['O Wi-Fi 6 e melhor?'],
                targetNodeId: 'assistant',
              },
            ],
          },
        },
        {
          id: 'catalog',
          kind: 'knowledge',
          title: 'Catalogo',
          subtitle: 'Base',
          position: { x: 220, y: 0 },
          config: {
            message: '{{customerMessage}}',
            requiredKnowledgeCoverage: 'medium',
          },
        },
        {
          id: 'assistant',
          kind: 'sub_agent',
          title: 'Raquel',
          subtitle: 'IA',
          position: { x: 440, y: 0 },
          config: {
            message: 'Responda usando a base.',
            useAi: true,
            requiredKnowledgeCoverage: 'medium',
          },
        },
      ],
      edges: [
        { id: 'triage-assistant', source: 'triage', target: 'assistant', routeId: 'duvida' },
        {
          id: 'catalog-assistant',
          source: 'catalog',
          target: 'assistant',
          sourceHandle: 'source-right-knowledge',
          targetHandle: 'target-left-knowledge',
        },
      ],
    };

    const graph = compileProcedureFromFlowGraph({
      flowGraph,
      configId: 'velpro',
      name: 'Raquel',
    }).graph!;

    const decisionStep = graph.steps.find((step) => step.visualNodeId === 'triage');
    const knowledgeStep = graph.steps.find((step) => step.visualNodeId === 'catalog');
    const assistantStep = graph.steps.find((step) => step.visualNodeId === 'assistant');

    expect(decisionStep?.branches?.[0]?.nextStepId).toBe(knowledgeStep?.id);
    expect(knowledgeStep?.nextStepId).toBe(assistantStep?.id);

    const prompts: string[] = [];
    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'E esse Wi-Fi 6 e o que?',
      decisionResolver: async () => 'Duvida sobre Planos',
      knowledgeResolver: async () => ({
        coverage: 'medium',
        chunks: [
          {
            documentId: 'wifi6',
            chunkId: 'wifi6-1',
            title: 'Wi-Fi 6',
            category: 'catalogo',
            score: 0.94,
            excerpt: 'Wi-Fi 6 melhora estabilidade e suporta mais dispositivos simultaneos.',
            source: 'knowledge_base',
          },
        ],
      }),
      responseResolver: async ({ prompt }) => {
        prompts.push(prompt);
        return 'Wi-Fi 6 melhora a estabilidade e suporta mais dispositivos ao mesmo tempo.';
      },
    });

    expect(result.status).toBe('waiting_input');
    expect(result.executedSteps).toEqual([decisionStep?.id, knowledgeStep?.id, assistantStep?.id]);
    expect(result.response).toContain('Wi-Fi 6 melhora');
    expect(prompts[0]).toContain('Contexto permitido da base de conhecimento');
    expect(prompts[0]).toContain('suporta mais dispositivos');
  });

  it('maps v2 sequential nodes to deterministic procedure steps with grounding', () => {
    const flowGraph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'start',
          kind: 'start',
          title: 'Inicio',
          subtitle: 'Entrada do flow',
          position: { x: 0, y: 0 },
        },
        {
          id: 'welcome',
          kind: 'message',
          title: 'Acolher',
          subtitle: 'Primeira mensagem',
          position: { x: 160, y: 0 },
          config: { message: 'Oi, vou te ajudar. Qual o motivo do contato?' },
        },
        {
          id: 'risk-decision',
          kind: 'decision',
          title: 'Classificar gravidade',
          subtitle: 'Rotas',
          position: { x: 360, y: 0 },
          config: {
            fallbackRouteId: 'fallback',
            routes: [
              {
                id: 'triagem',
                label: 'Sintomas ou risco',
                description: 'Cliente relata febre, dor, urgencia ou sintoma.',
                examples: ['meu filho esta com febre'],
              },
              {
                id: 'fallback',
                label: 'Esclarecer',
                description: 'Nao ficou claro.',
                examples: ['e agora?'],
              },
            ],
          },
        },
        {
          id: 'collect-child',
          kind: 'collect',
          title: 'Coletar dados da crianca',
          subtitle: 'Nome e idade',
          position: { x: 560, y: -80 },
          config: {
            formFields: [
              { id: 'child_name', label: 'Nome da crianca', type: 'name', required: true },
              { id: 'child_age', label: 'Idade da crianca', type: 'text', required: true },
            ],
            maxAttempts: 2,
          },
        },
        {
          id: 'kb',
          kind: 'knowledge',
          title: 'Buscar orientacoes',
          subtitle: 'Base',
          position: { x: 760, y: -80 },
          config: {
            message: 'Sintoma: {{customerMessage}}',
            requiredKnowledgeCoverage: 'high',
          },
        },
        {
          id: 'compose',
          kind: 'sub_agent',
          title: 'Responder com base',
          subtitle: 'Grounded',
          position: { x: 960, y: -80 },
          config: {
            message: 'Responda com acolhimento e base.',
            requiredKnowledgeCoverage: 'medium',
          },
        },
        {
          id: 'clarify',
          kind: 'message',
          title: 'Pedir esclarecimento',
          subtitle: 'Fallback',
          position: { x: 560, y: 140 },
          config: { message: 'Pode me explicar melhor o que aconteceu?' },
        },
      ],
      edges: [
        { id: 'start-welcome', source: 'start', target: 'welcome' },
        { id: 'welcome-decision', source: 'welcome', target: 'risk-decision' },
        { id: 'decision-collect', source: 'risk-decision', target: 'collect-child', routeId: 'triagem' },
        { id: 'collect-kb', source: 'collect-child', target: 'kb' },
        { id: 'kb-compose', source: 'kb', target: 'compose' },
        { id: 'decision-clarify', source: 'risk-decision', target: 'clarify', routeId: 'fallback' },
      ],
    };

    const result = compileProcedureFromFlowGraph({
      flowGraph,
      configId: 'agent-v2',
      name: 'Fluxo v2 sequencial',
    });

    expect(result.success).toBe(true);
    const graph = result.graph!;
    expect(graph.steps.map((step) => step.type)).toEqual([
      'respond',
      'decide',
      'gather_data',
      'retrieve_knowledge',
      'respond',
      'respond',
    ]);
    expect(graph.steps.find((step) => step.visualNodeId === 'collect-child')).toMatchObject({
      requiredSlots: ['child_name', 'child_age'],
      maxRetries: 2,
    });
    expect(graph.steps.find((step) => step.visualNodeId === 'kb')).toMatchObject({
      type: 'retrieve_knowledge',
      requiredKnowledgeCoverage: 'high',
    });
    expect(graph.steps.find((step) => step.visualNodeId === 'compose')).toMatchObject({
      type: 'respond',
      requireGrounding: true,
    });
  });

  it('keeps pediatric fever on the triage path even when the LLM proposes scheduling', async () => {
    const flowGraph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'start',
          kind: 'start',
          title: 'Entrada',
          subtitle: 'Inicio',
          position: { x: 0, y: 0 },
        },
        {
          id: 'central',
          kind: 'decision',
          title: 'Decisor central Dra Roberta',
          subtitle: 'Triagem antes de agenda',
          position: { x: 200, y: 0 },
          config: {
            fallbackRouteId: 'fallback',
            routes: [
              {
                id: 'sintomas',
                label: 'Triagem de sintomas pediatricos',
                description: 'Use quando houver febre, tosse, vomito, diarreia, dificuldade respiratoria, bebe doente ou qualquer sintoma de saude.',
                examples: ['meu bebe de 6 meses esta com febre', 'crianca com febre 38.5 desde ontem'],
              },
              {
                id: 'agendar',
                label: 'Agendamento administrativo',
                description: 'Use somente quando o responsavel pede horario, consulta, agenda ou remarcacao sem relatar sintoma atual.',
                examples: ['quero marcar consulta de rotina', 'tem horario amanha?'],
              },
              {
                id: 'fallback',
                label: 'Esclarecer',
                description: 'Quando nao houver evidencia suficiente.',
                examples: ['e agora?'],
              },
            ],
          },
        },
        {
          id: 'triagem',
          kind: 'message',
          title: 'Investigar sinais',
          subtitle: 'Perguntas clinicas',
          position: { x: 460, y: -120 },
          config: {
            message: 'Vamos fazer a triagem antes de qualquer agendamento. Qual e a idade da crianca e qual temperatura foi medida?',
          },
        },
        {
          id: 'dados-agenda',
          kind: 'collect',
          title: 'Dados para agendamento',
          subtitle: 'Nome e telefone',
          position: { x: 460, y: 120 },
          config: {
            formFields: [
              { id: 'nome_resp', label: 'Nome completo do responsavel', type: 'name', required: true },
              { id: 'tel_resp', label: 'Telefone de contato', type: 'phone', required: true },
            ],
          },
        },
        {
          id: 'fallback',
          kind: 'message',
          title: 'Perguntar melhor',
          subtitle: 'Fallback',
          position: { x: 460, y: 260 },
          config: { message: 'Pode me contar o que a crianca esta sentindo?' },
        },
      ],
      edges: [
        { id: 'start-decision', source: 'start', target: 'central' },
        { id: 'route-sintomas', source: 'central', target: 'triagem', routeId: 'sintomas' },
        { id: 'route-agendar', source: 'central', target: 'dados-agenda', routeId: 'agendar' },
        { id: 'route-fallback', source: 'central', target: 'fallback', routeId: 'fallback' },
      ],
    };

    const compiled = compileProcedureFromFlowGraph({
      flowGraph,
      configId: 'dra-roberta',
      name: 'Dra Roberta',
    }).graph!;
    const runtimeContext = contextFor(compiled);

    const result = await advanceProcedure({
      graph: compiled,
      context: runtimeContext,
      customerMessage: 'meu bebe de 6 meses esta com febre 38.5 desde ontem',
      decisionResolver: async () => 'Agendamento administrativo',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toContain('triagem antes de qualquer agendamento');
    expect(result.executedSteps).toEqual([
      compiled.steps.find((step) => step.visualNodeId === 'central')?.id,
      compiled.steps.find((step) => step.visualNodeId === 'triagem')?.id,
    ]);
    expect(runtimeContext.currentStepId).not.toBe(
      compiled.steps.find((step) => step.visualNodeId === 'dados-agenda')?.id
    );
  });
});
