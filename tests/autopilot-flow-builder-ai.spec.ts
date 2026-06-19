import { describe, expect, it } from 'vitest';

import {
  applyToolSelection,
  ensureOperationalCoverage,
  sanitizeAutopilotFlowProposal,
} from '@/ai/flows/autopilot-flow-builder';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';

describe('autopilot flow builder AI sanitizer', () => {
  it('keeps catalog tools and removes invented tools and broken edges', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow comercial com transferencia.',
      systemPrompt: 'Atenda clientes e use @transferir quando solicitado.',
      nodes: [
        { id: 'agent', kind: 'assistant', title: 'Agente', subtitle: 'IA', x: 400, y: 300 },
        {
          id: 'transferir',
          kind: 'tool',
          title: 'Transferir',
          subtitle: 'Dialogy',
          x: 700,
          y: 360,
          toolName: 'transfer_chat',
          instructions: 'Transfira somente quando solicitado.',
        },
        {
          id: 'inventada',
          kind: 'tool',
          title: 'Tool inventada',
          subtitle: 'Invalida',
          x: 700,
          y: 500,
          toolName: 'apagar_tudo',
        },
      ],
      edges: [
        { source: 'agent', target: 'transferir' },
        { source: 'agent', target: 'inventada' },
        { source: 'inexistente', target: 'transferir' },
      ],
    }, listAgentToolCatalogItems());

    expect(proposal.enabledToolNames).toEqual(['transfer_chat']);
    expect(proposal.flowGraph.nodes.map((node) => node.id)).toEqual(['agent', 'transferir']);
    expect(proposal.flowGraph.edges).toHaveLength(1);
    expect(proposal.flowGraph.edges[0]).toMatchObject({ source: 'agent', target: 'transferir' });
  });

  it('injects a principal sub_agent when the model omits one', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow minimo.',
      systemPrompt: 'Ajude o cliente.',
      nodes: [{ id: 'entrada', kind: 'trigger', title: 'Entrada', subtitle: 'Inicio', x: 100, y: 100 }],
      edges: [],
    }, []);

    expect(proposal.flowGraph.nodes.some((node) => node.kind === 'sub_agent')).toBe(true);
    expect(proposal.flowGraph.nodes.some((node) => node.kind === 'assistant')).toBe(false);
    expect(proposal.flowGraph.nodes.every((node) => Boolean(node.config?.instructions?.trim()))).toBe(true);
  });

  it('repairs decision nodes without a safe fallback for topic shifts and outside-procedure questions', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Triagem pediatrica com classificacao de risco.',
      systemPrompt: 'Siga a triagem e transfira casos graves.',
      nodes: [
        { id: 'start', kind: 'start', title: 'Start', subtitle: 'Inicio', x: 80, y: 120 },
        { id: 'acolhimento', kind: 'message', title: 'Acolhimento', subtitle: 'Boas-vindas', x: 280, y: 120 },
        {
          id: 'classificacao-risco',
          kind: 'decision',
          title: 'Classificação de Risco',
          subtitle: 'Azul, amarelo ou vermelho',
          x: 520,
          y: 120,
          routes: [
            {
              id: 'azul',
              label: 'Azul',
              description: 'Sintomas leves.',
              targetNodeId: 'responder',
            },
            {
              id: 'vermelho',
              label: 'Vermelho',
              description: 'Sinais graves.',
              targetNodeId: 'transferir',
            },
          ],
        },
        { id: 'responder', kind: 'sub_agent', title: 'Triagem', subtitle: 'Responder', x: 780, y: 200 },
        { id: 'transferir', kind: 'handoff', title: 'Transferir', subtitle: 'Humano', x: 780, y: 20 },
      ],
      edges: [
        { source: 'start', target: 'acolhimento' },
        { source: 'acolhimento', target: 'classificacao-risco' },
        { source: 'classificacao-risco', target: 'responder', routeId: 'azul' },
        { source: 'classificacao-risco', target: 'transferir', routeId: 'vermelho' },
      ],
    }, listAgentToolCatalogItems());

    const decision = proposal.flowGraph.nodes.find((node) => node.id === 'classificacao-risco');
    const fallbackRouteId = decision?.config?.fallbackRouteId;
    const fallbackRoute = decision?.config?.routes?.find((route) => route.id === fallbackRouteId);
    const fallbackTarget = proposal.flowGraph.nodes.find((node) => node.id === fallbackRoute?.targetNodeId);
    const audit = auditAutopilotFlowGraph(proposal.flowGraph);

    expect(fallbackRouteId).toBe('fallback');
    expect(fallbackTarget?.kind).toBe('message');
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'classificacao-risco',
        target: fallbackTarget?.id,
        routeId: 'fallback',
      }),
    ]));
    expect(audit.issues.map((issue) => issue.code)).not.toEqual(expect.arrayContaining([
      'simulation_topic_shift_guard_failed',
      'simulation_generic_outside_procedure_failed',
    ]));
  });

  it('repairs orphan knowledge, normalizes literal reference placeholders and converts legacy assistants to sub_agents', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow comercial com base de planos.',
      systemPrompt: 'Consulte @referenceId: knowledge_plans e encerre com @close_chat.',
      nodes: [
        { id: 'agent-main', kind: 'assistant', title: 'Raquel', subtitle: 'Principal', x: 500, y: 300 },
        {
          id: 'agent-sales',
          kind: 'assistant',
          title: 'Raquel - Comercial',
          subtitle: 'Atender novos clientes',
          x: 780,
          y: 300,
          instructions: 'Apresente planos e colete os dados do cliente.',
        },
        {
          id: 'knowledge-plans',
          kind: 'knowledge',
          title: 'Consulta Planos',
          subtitle: 'Buscar planos',
          x: 720,
          y: 520,
        },
        {
          id: 'tool-close-chat',
          kind: 'tool',
          title: 'Encerrar conversa',
          subtitle: 'Dialogy',
          x: 1040,
          y: 300,
          toolName: 'close_chat',
          instructions: 'Use @referenceId: agent_sales somente depois de confirmar que o atendimento terminou.',
        },
      ],
      edges: [],
    }, listAgentToolCatalogItems());

    expect(proposal.systemPrompt).toBe('Consulte @knowledge_plans e encerre com @tool_close_chat.');
    expect(proposal.flowGraph.nodes.filter((node) => node.kind === 'assistant')).toHaveLength(0);
    expect(proposal.flowGraph.nodes.filter((node) => node.kind === 'sub_agent')).toHaveLength(2);
    const subAgent = proposal.flowGraph.nodes.find((node) => node.id === 'agent-sales');
    expect(subAgent).toMatchObject({
      kind: 'sub_agent',
      config: {
        instructions: 'Apresente planos e colete os dados do cliente.',
        customIntentLabel: 'Raquel - Comercial',
        useAi: true,
      },
    });
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'knowledge-plans', target: 'agent-sales' }),
      expect.objectContaining({ source: 'agent-sales', target: 'tool-close-chat' }),
    ]));
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'tool-close-chat')?.config?.instructions)
      .toBe('Use @agent_sales somente depois de confirmar que o atendimento terminou.');
  });

  it('fills contextual instructions for every block when the model leaves operational prompts empty', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow com prompts incompletos.',
      systemPrompt: 'Atenda o cliente.',
      nodes: [
        { id: 'entrada', kind: 'trigger', title: 'Mensagem recebida', subtitle: 'Inicio', x: 100, y: 100 },
        { id: 'entender', kind: 'understand', title: 'Entender cliente', subtitle: 'Classificar necessidade', x: 300, y: 100 },
        { id: 'agente', kind: 'assistant', title: 'Agente', subtitle: 'Responder', x: 500, y: 100 },
        { id: 'base', kind: 'knowledge', title: 'Base comercial', subtitle: 'Consultar catalogo', x: 500, y: 300 },
        { id: 'encerrar', kind: 'tool', title: 'Encerrar', subtitle: 'Dialogy', x: 700, y: 100, toolName: 'close_chat' },
      ],
      edges: [
        { source: 'entrada', target: 'entender' },
        { source: 'entender', target: 'agente' },
      ],
    }, listAgentToolCatalogItems());

    expect(proposal.flowGraph.nodes.every((node) => Boolean(node.config?.instructions?.trim()))).toBe(true);
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'base')?.config?.instructions)
      .toContain('Consulte a base de conhecimento');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'encerrar')?.config?.instructions)
      .toContain('close_chat');
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'base', target: 'agente' }),
      expect.objectContaining({ source: 'agente', target: 'encerrar' }),
    ]));
    expect(proposal.flowGraph.nodes.map((node) => node.kind)).not.toEqual(expect.arrayContaining([
      'trigger',
      'understand',
      'assistant',
    ]));
  });

  it('normalizes legacy intent blocks into v2 decision blocks', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow com etapas sequenciais.',
      systemPrompt: 'Atenda o cliente.',
      nodes: [
        { id: 'agente', kind: 'assistant', title: 'Agente', subtitle: 'Principal', x: 100, y: 100 },
        { id: 'etapa-a', kind: 'intent', title: 'Checagem', subtitle: 'Validar', x: 300, y: 100, intent: 'unknown' },
        { id: 'etapa-b', kind: 'intent', title: 'Finalizacao', subtitle: 'Concluir', x: 500, y: 100, intent: 'unknown' },
      ],
      edges: [
        { source: 'agente', target: 'etapa-a' },
        { source: 'etapa-a', target: 'etapa-b' },
      ],
    }, []);

    expect(proposal.flowGraph.nodes.find((node) => node.id === 'etapa-a')?.kind).toBe('decision');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'etapa-b')?.kind).toBe('decision');
  });

  it('fills v2 message text when legacy message blocks arrive empty', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow com mensagem vazia.',
      systemPrompt: 'Atenda o cliente.',
      nodes: [
        { id: 'entrada', kind: 'trigger', title: 'Mensagem recebida', subtitle: 'Inicio', x: 100, y: 100 },
        { id: 'boas-vindas', kind: 'send_message', title: 'Boas-vindas', subtitle: 'Mensagem inicial', x: 300, y: 100 },
        { id: 'agente', kind: 'assistant', title: 'Agente', subtitle: 'Responder', x: 500, y: 100 },
      ],
      edges: [
        { source: 'entrada', target: 'boas-vindas' },
        { source: 'boas-vindas', target: 'agente' },
      ],
    }, []);

    const messageNode = proposal.flowGraph.nodes.find((node) => node.id === 'boas-vindas');
    expect(messageNode?.kind).toBe('message');
    expect(messageNode?.config?.message).toBe('Mensagem inicial');
  });

  it('adds only catalog tools explicitly selected after block analysis', () => {
    const architecture = {
      summary: 'Atendimento simples.',
      systemPrompt: 'Ajude o cliente.',
      nodes: [{ id: 'agente', kind: 'sub_agent' as const, title: 'Agente', subtitle: 'Principal', x: 100, y: 100 }],
      edges: [],
    };
    const tools = listAgentToolCatalogItems();
    const withTools = applyToolSelection(architecture, {
      tools: [
        {
          attachToNodeId: 'agente',
          toolName: 'close_chat',
          title: 'Encerrar atendimento',
          subtitle: 'Dialogy',
          instructions: 'Use somente quando o cliente pedir encerramento.',
        },
        {
          attachToNodeId: 'agente',
          toolName: 'inventada',
          title: 'Inventada',
          subtitle: 'Invalida',
          instructions: 'Nao deve entrar.',
        },
      ],
    }, tools);

    expect(withTools.nodes.filter((node) => node.kind === 'tool').map((node) => node.toolName)).toEqual(['close_chat']);
    expect(withTools.edges).toEqual([{ source: 'agente', target: 'tool-close_chat' }]);
    expect(applyToolSelection(architecture, { tools: [] }, tools).nodes).toEqual(architecture.nodes);
  });

  it('repairs missing knowledge and essential operational tools after neural selection', () => {
    const architecture = {
      summary: 'Fluxo comercial com cadastro e finalizacao.',
      systemPrompt: 'Colete os dados do lead, atualize o cadastro e encerre o atendimento quando concluido.',
      nodes: [
        { id: 'agente', kind: 'sub_agent' as const, title: 'Agente', subtitle: 'Principal', x: 400, y: 200 },
        {
          id: 'coletar-lead',
          kind: 'collect' as const,
          title: 'Coletar lead',
          subtitle: 'Dados do lead',
          x: 700,
          y: 200,
        },
      ],
      edges: [],
    };

    const repaired = ensureOperationalCoverage(architecture, listAgentToolCatalogItems());
    const knowledge = repaired.nodes.find((node) => node.kind === 'knowledge');
    const close = repaired.nodes.find((node) => node.toolName === 'close_chat');
    const crm = repaired.nodes.find((node) => node.toolName === 'crm_update_contact_custom_fields');

    expect(knowledge).toBeDefined();
    expect(close).toBeDefined();
    expect(crm).toBeDefined();
    expect(repaired.edges).toEqual(expect.arrayContaining([
      { source: knowledge?.id, target: 'agente' },
      { source: 'agente', target: close?.id },
      { source: 'coletar-lead', target: crm?.id },
    ]));
    expect(repaired.edges).not.toEqual(expect.arrayContaining([
      { source: knowledge?.id, target: 'coletar-lead' },
      { source: 'coletar-lead', target: close?.id },
    ]));
  });

  it('respects an explicit request for a flow without knowledge base', () => {
    const architecture = {
      summary: 'Flow sem base de conhecimento.',
      systemPrompt: 'Nao use RAG. Apenas envie uma mensagem fixa.',
      nodes: [{ id: 'agente', kind: 'sub_agent' as const, title: 'Agente', subtitle: 'Principal', x: 100, y: 100 }],
      edges: [],
    };

    const repaired = ensureOperationalCoverage(architecture, listAgentToolCatalogItems());

    expect(repaired.nodes.some((node) => node.kind === 'knowledge')).toBe(false);
  });

  it('preserves decision routes and removes invalid route targets from legacy switch proposals', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow de suporte Wi-Fi com switch.',
      systemPrompt: 'Classifique o problema em @switch_wifi.',
      nodes: [
        { id: 'incoming', kind: 'trigger', title: 'Mensagem recebida', subtitle: 'Inicio', x: 100, y: 100 },
        {
          id: 'switch-wifi',
          kind: 'switch',
          title: 'Switch Wi-Fi',
          subtitle: 'Escolher caminho',
          x: 320,
          y: 100,
          instructions: 'Escolha uma rota conforme o problema de Wi-Fi.',
          referenceId: 'switch_wifi',
          switchMode: 'ai',
          confidenceThreshold: 0.8,
          fallbackRouteId: 'outro',
          routes: [
            {
              id: 'alterar_wifi',
              label: 'Alterar nome/senha',
              description: 'Cliente quer trocar nome da rede ou senha do Wi-Fi.',
              examples: ['Quero trocar a senha do Wi-Fi'],
              requiredSlots: ['wifi_ssid', 'wifi_password'],
              targetNodeId: 'coletar-wifi',
            },
            {
              id: 'outro',
              label: 'Outro',
              description: 'Nao ficou claro qual problema o cliente tem.',
              targetNodeId: 'node-inexistente',
            },
          ],
        },
        { id: 'coletar-wifi', kind: 'form', title: 'Coletar Wi-Fi', subtitle: 'Dados novos', x: 540, y: 100 },
        { id: 'agente', kind: 'assistant', title: 'Agente', subtitle: 'Responder', x: 320, y: 320 },
      ],
      edges: [
        { source: 'incoming', target: 'switch-wifi' },
        { source: 'switch-wifi', target: 'coletar-wifi' },
      ],
    }, listAgentToolCatalogItems());

    const switchNode = proposal.flowGraph.nodes.find((node) => node.id === 'switch-wifi');

    expect(switchNode?.kind).toBe('decision');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'coletar-wifi')?.kind).toBe('collect');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'agente')?.kind).toBe('sub_agent');
    expect(switchNode?.config?.confidenceThreshold).toBe(0.8);
    expect(switchNode?.config?.fallbackRouteId).toBe('outro');
    const fallbackTarget = proposal.flowGraph.nodes.find((node) => (
      node.id === switchNode?.config?.routes?.find((route) => route.id === 'outro')?.targetNodeId
    ));
    expect(switchNode?.config?.routes).toEqual([
      expect.objectContaining({
        id: 'alterar_wifi',
        label: 'Alterar nome/senha',
        requiredSlots: ['wifi_ssid', 'wifi_password'],
        targetNodeId: 'coletar-wifi',
      }),
      expect.objectContaining({
        id: 'outro',
        targetNodeId: fallbackTarget?.id,
      }),
    ]);
    expect(fallbackTarget?.kind).toBe('message');
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'switch-wifi', target: 'coletar-wifi' }),
      expect.objectContaining({ source: 'switch-wifi', target: fallbackTarget?.id, routeId: 'outro' }),
    ]));
  });

  it('preserves v2 node contracts and does not inject legacy assistant when sub_agent exists', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Manifest: suporte sequencial com base e coleta.',
      procedureManifest: 'Objetivo: coletar telefone, buscar base e responder com grounding.',
      systemPrompt: 'Siga @responder.',
      nodes: [
        { id: 'inicio', kind: 'start', title: 'Inicio', subtitle: 'Entrada', x: 0, y: 0 },
        {
          id: 'coletar',
          kind: 'collect',
          title: 'Coletar telefone',
          subtitle: 'Dados',
          x: 220,
          y: 0,
          maxAttempts: 2,
          formFields: [
            { id: 'telefone', label: 'Telefone com DDD', fieldKey: 'phone', type: 'phone', aliases: ['whatsapp'], required: true },
          ],
        },
        {
          id: 'base',
          kind: 'knowledge',
          title: 'Base suporte',
          subtitle: 'RAG',
          x: 440,
          y: 0,
          requiredKnowledgeCoverage: 'medium',
        },
        {
          id: 'responder',
          kind: 'sub_agent',
          title: 'Responder',
          subtitle: 'Grounded',
          x: 660,
          y: 0,
          requiredKnowledgeCoverage: 'medium',
          instructions: 'Use apenas chunks recuperados.',
        },
      ],
      edges: [
        { source: 'inicio', target: 'coletar' },
        { source: 'coletar', target: 'base' },
        { source: 'base', target: 'responder' },
      ],
    }, []);

    expect(proposal.procedureManifest).toContain('coletar telefone');
    expect(proposal.flowGraph.nodes.some((node) => node.kind === 'assistant')).toBe(false);
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'responder')?.kind).toBe('sub_agent');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'coletar')?.config).toMatchObject({
      maxAttempts: 2,
      formFields: [
        expect.objectContaining({
          fieldKey: 'phone',
          type: 'phone',
          aliases: ['whatsapp'],
        }),
      ],
    });
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'base')?.config).toMatchObject({
      requiredKnowledgeCoverage: 'medium',
    });
  });
});
