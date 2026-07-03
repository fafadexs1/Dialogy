import { describe, expect, it } from 'vitest';

import {
  applyToolSelection,
  buildFallbackArchitecture,
  buildDeterministicFallbackProposal,
  ensureToolRelevanceCoverage,
  buildToolRelevanceMap,
  ensureOperationalCoverage,
  sanitizeAutopilotFlowProposal,
} from '@/ai/flows/autopilot-flow-builder';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';

function mcpTool(name: string, description: string): AgentToolCatalogItem {
  return {
    name: name as AgentToolCatalogItem['name'],
    version: 'mcp',
    description,
    class: 'retrieval',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: ['troubleshooting', 'support_request'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: 'mcp',
    enabledByDefault: false,
    serverId: 'router',
    serverName: 'Router MCP',
    inputSchema: { type: 'object', properties: {} },
  };
}

function highRiskMcpTool(name: string, description: string): AgentToolCatalogItem {
  return {
    ...mcpTool(name, description),
    class: 'write_non_idempotent',
    riskLevel: 'high',
    sideEffect: 'high',
    idempotent: false,
    requiresHumanApproval: true,
  };
}

function reachableNodeIds(
  graph: ReturnType<typeof buildDeterministicFallbackProposal>['flowGraph'],
  startId: string,
) {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of graph.edges.filter((candidate) => candidate.source === current)) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }
  return visited;
}

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

  it('fills deterministic positions when the model omits architecture coordinates', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow sem coordenadas.',
      systemPrompt: 'Ajude o cliente.',
      nodes: [
        { id: 'entrada', kind: 'start', title: 'Entrada', subtitle: 'Inicio' } as any,
        { id: 'triagem', kind: 'decision', title: 'Triagem', subtitle: 'Rotas' } as any,
      ],
      edges: [],
    } as any, []);

    expect(proposal.flowGraph.nodes[0].position).toEqual({ x: 120, y: 120 });
    expect(proposal.flowGraph.nodes[1].position).toEqual({ x: 380, y: 120 });
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

  it('uses a customer-facing greeting instead of an architectural subtitle', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow V2 com saudacao.',
      systemPrompt: 'Atenda o cliente.',
      nodes: [
        { id: 'inicio', kind: 'start', title: 'Inicio', subtitle: 'Entrada', x: 100, y: 100 },
        {
          id: 'boas-vindas',
          kind: 'message',
          title: 'Boas-vindas e triagem',
          subtitle: 'Apresentar o atendimento e entender o objetivo do cliente',
          x: 300,
          y: 100,
        },
        { id: 'agente', kind: 'sub_agent', title: 'Agente', subtitle: 'Responder', x: 500, y: 100 },
      ],
      edges: [
        { source: 'inicio', target: 'boas-vindas' },
        { source: 'boas-vindas', target: 'agente' },
      ],
    }, []);

    expect(proposal.flowGraph.nodes.find((node) => node.id === 'boas-vindas')?.config?.message)
      .toBe('Ola! Como posso ajudar voce hoje?');
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

  it('builds a qualified MCP relevance map for Wi-Fi credential lookup without selecting reboot', () => {
    const tools = [
      listAgentToolCatalogItems().find((item) => item.name === 'sgp_fetch_contact_panel_data')!,
      mcpTool('mcp:router:get_wifi_view', 'Consulta SSID, usuario e senha atuais do Wi-Fi.'),
      mcpTool('mcp:router:reboot_router', 'Reinicia o roteador do assinante.'),
      mcpTool('mcp:router:scan_wifi_neighbors', 'Analisa redes Wi-Fi ao redor, canais e interferencia.'),
    ];

    const relevance = buildToolRelevanceMap({
      conversation: [
        {
          role: 'user',
          content: 'Esqueci o usuario e senha do Wi-Fi. Pode verificar?',
        },
      ],
      tools,
    });

    expect(relevance.map((item) => item.toolName)).toEqual(expect.arrayContaining([
      'sgp_fetch_contact_panel_data',
      'mcp:router:get_wifi_view',
    ]));
    expect(relevance.map((item) => item.toolName)).not.toContain('mcp:router:reboot_router');
    expect(relevance.find((item) => item.toolName === 'mcp:router:get_wifi_view')?.intents)
      .toContain('wifi_credentials_lookup');
  });

  it('isolates a deterministic Wi-Fi credential lookup from change and reboot branches', () => {
    const sgp = listAgentToolCatalogItems().find((item) => item.name === 'sgp_fetch_contact_panel_data')!;
    const getWifi = mcpTool(
      'mcp:router:get_wifi_view',
      'Consulta SSID, usuario e senha atuais do Wi-Fi pelo contrato validado.',
    );
    const changeWifi = highRiskMcpTool(
      'mcp:router:update_wifi_credentials',
      'Altera nome ou senha do Wi-Fi com confirmacao explicita.',
    );
    const reboot = highRiskMcpTool(
      'mcp:router:reboot_router',
      'Reinicia o roteador somente com confirmacao explicita.',
    );
    const proposal = buildDeterministicFallbackProposal({
      conversation: [{
        role: 'user',
        content: 'Crie um fluxo para quando o cliente esquecer o usuario e senha do Wi-Fi.',
      }],
      currentSystemPrompt: null,
      tools: [sgp, getWifi, changeWifi, reboot],
    }, new Error('invalid architecture'));
    const decision = proposal.flowGraph.nodes.find((node) => node.id === 'triagem');
    const lookupRoute = decision?.config?.routes?.find((route) => route.id === 'consultar_wifi');
    const reachable = reachableNodeIds(proposal.flowGraph, lookupRoute?.targetNodeId || '');
    const reachableTools = proposal.flowGraph.nodes
      .filter((node) => reachable.has(node.id) && node.kind === 'tool')
      .map((node) => node.toolName);

    expect(reachableTools).toEqual(expect.arrayContaining([
      'sgp_fetch_contact_panel_data',
      'mcp:router:get_wifi_view',
    ]));
    expect(reachableTools).not.toContain('mcp:router:update_wifi_credentials');
    expect(reachableTools).not.toContain('mcp:router:reboot_router');
    expect(
      proposal.flowGraph.nodes.some((node) => (
        reachable.has(node.id)
        && /troca|reboot/i.test(`${node.id} ${node.title}`)
      )),
    ).toBe(false);
    expect(auditAutopilotFlowGraph(proposal.flowGraph).status).toBe('passed');
  });

  it('keeps every complete Wi-Fi capability on its own deterministic branch', () => {
    const sgp = listAgentToolCatalogItems().find((item) => item.name === 'sgp_fetch_contact_panel_data')!;
    const getWifi = mcpTool(
      'mcp:router:get_wifi_view',
      'Consulta SSID, usuario e senha atuais do Wi-Fi pelo contrato validado.',
    );
    const scan = mcpTool(
      'mcp:router:scan_wifi_neighbors',
      'Escaneia redes Wi-Fi ao redor, canais e interferencia.',
    );
    const cachedScan = mcpTool(
      'mcp:router:get_wifi_scan_cached',
      'Consulta o ultimo scan de canais Wi-Fi em cache.',
    );
    const changeWifi = highRiskMcpTool(
      'mcp:router:update_wifi_credentials',
      'Altera nome ou senha do Wi-Fi com confirmacao explicita.',
    );
    changeWifi.inputSchema = {
      type: 'object',
      required: ['contract_id', 'new_password'],
      properties: {
        contract_id: { type: 'string' },
        new_password: { type: 'string' },
      },
    };
    const reboot = highRiskMcpTool(
      'mcp:router:reboot_router',
      'Reinicia o roteador pelo contrato somente com confirmacao explicita.',
    );
    const proposal = buildDeterministicFallbackProposal({
      conversation: [{
        role: 'user',
        content: [
          'Monte suporte Wi-Fi completo.',
          'Consultar usuario e senha atuais.',
          'Diagnosticar canais, redes ao redor e interferencia.',
          'Trocar nome ou senha somente com confirmacao.',
          'Reiniciar roteador somente com confirmacao.',
          'Sempre validar CPF e contrato.',
        ].join(' '),
      }],
      currentSystemPrompt: null,
      tools: [sgp, getWifi, scan, cachedScan, changeWifi, reboot],
    }, new Error('invalid architecture'));
    const decision = proposal.flowGraph.nodes.find((node) => node.id === 'triagem');
    const toolNamesByRoute = new Map(
      ['consultar_wifi', 'diagnosticar_wifi', 'trocar_wifi', 'reiniciar_roteador'].map((routeId) => {
        const route = decision?.config?.routes?.find((candidate) => candidate.id === routeId);
        const reachable = reachableNodeIds(proposal.flowGraph, route?.targetNodeId || '');
        return [
          routeId,
          proposal.flowGraph.nodes
            .filter((node) => reachable.has(node.id) && node.kind === 'tool')
            .map((node) => node.toolName),
        ];
      }),
    );

    expect(toolNamesByRoute.get('consultar_wifi')).toContain('mcp:router:get_wifi_view');
    expect(toolNamesByRoute.get('consultar_wifi')).not.toContain('mcp:router:reboot_router');
    expect(toolNamesByRoute.get('diagnosticar_wifi')).toEqual(expect.arrayContaining([
      'mcp:router:scan_wifi_neighbors',
      'mcp:router:get_wifi_scan_cached',
    ]));
    expect(toolNamesByRoute.get('diagnosticar_wifi')).not.toContain('mcp:router:update_wifi_credentials');
    expect(toolNamesByRoute.get('trocar_wifi')).toContain('mcp:router:update_wifi_credentials');
    expect(toolNamesByRoute.get('trocar_wifi')).not.toContain('mcp:router:reboot_router');
    expect(toolNamesByRoute.get('reiniciar_roteador')).toContain('mcp:router:reboot_router');
    expect(toolNamesByRoute.get('reiniciar_roteador')).not.toContain('mcp:router:update_wifi_credentials');
    expect(auditAutopilotFlowGraph(proposal.flowGraph).status).toBe('passed');
  });

  it('builds a qualified MCP relevance map for generic order status by description and schema', () => {
    const tools = [
      mcpTool('mcp:ecommerce:get_order_status', 'Consulta status, rastreio e previsao de entrega de um pedido pelo numero do pedido.'),
      highRiskMcpTool('mcp:ecommerce:cancel_order', 'Cancela um pedido e estorna a compra.'),
      mcpTool('mcp:router:reboot_router', 'Reinicia o roteador do assinante.'),
    ];
    tools[0].inputSchema = { type: 'object', properties: { order_id: { type: 'string' } } };

    const relevance = buildToolRelevanceMap({
      conversation: [
        {
          role: 'user',
          content: 'Preciso consultar o status do pedido AB1234 e o codigo de rastreio.',
        },
      ],
      tools,
    });

    expect(relevance.map((item) => item.toolName)).toContain('mcp:ecommerce:get_order_status');
    expect(relevance.find((item) => item.toolName === 'mcp:ecommerce:get_order_status')?.intents)
      .toContain('order_status_lookup');
    expect(relevance.map((item) => item.toolName)).not.toContain('mcp:ecommerce:cancel_order');
    expect(relevance.map((item) => item.toolName)).not.toContain('mcp:router:reboot_router');
  });

  it('selects read-only commerce MCPs for catalog, pricing and availability while blocking destructive tools', () => {
    const tools = [
      mcpTool('mcp:commerce:list_products', 'Lista catalogo de produtos, precos, estoque e disponibilidade.'),
      highRiskMcpTool('mcp:commerce:refund_order', 'Estorna pagamento, cancela pedido e altera a compra.'),
    ];

    const relevance = buildToolRelevanceMap({
      conversation: [
        {
          role: 'user',
          content: 'Monte um fluxo para consultar catalogo, preco e disponibilidade dos produtos.',
        },
      ],
      tools,
    });

    const catalogTool = relevance.find((item) => item.toolName === 'mcp:commerce:list_products');
    expect(catalogTool?.intents).toEqual(expect.arrayContaining([
      'catalog_lookup',
      'pricing_lookup',
      'availability_lookup',
    ]));
    expect(relevance.map((item) => item.toolName)).not.toContain('mcp:commerce:refund_order');
  });

  it('selects a custom mutating MCP only when its action and business object match', () => {
    const approveClaim = highRiskMcpTool(
      'mcp:insurance:approve_claim',
      'Aprova um sinistro de seguro pelo claim_id informado.',
    );
    approveClaim.inputSchema = {
      type: 'object',
      required: ['claim_id', 'approval_reason'],
      properties: {
        claim_id: { type: 'string', description: 'Identificador do sinistro' },
        approval_reason: { type: 'string', description: 'Motivo da aprovacao' },
      },
    };
    const cancelOrder = highRiskMcpTool(
      'mcp:commerce:cancel_order',
      'Cancela definitivamente um pedido pelo order_id.',
    );

    const relevance = buildToolRelevanceMap({
      conversation: [{
        role: 'user',
        content: 'Crie um fluxo para aprovar um sinistro usando claim_id e o motivo da aprovacao.',
      }],
      tools: [approveClaim, cancelOrder],
    });

    expect(relevance.find((entry) => entry.toolName === approveClaim.name)?.intents)
      .toContain('external_action');
    expect(relevance.map((entry) => entry.toolName)).not.toContain(cancelOrder.name);
  });

  it('builds a capability-specific fallback branch from an arbitrary MCP schema', () => {
    const approveClaim = highRiskMcpTool(
      'mcp:insurance:approve_claim',
      'Aprova um sinistro de seguro pelo claim_id informado.',
    );
    approveClaim.inputSchema = {
      type: 'object',
      required: ['claim_id', 'approval_reason'],
      properties: {
        claim_id: { type: 'string', title: 'Numero do sinistro' },
        approval_reason: { type: 'string', title: 'Motivo da aprovacao' },
      },
    };
    const fallback = buildFallbackArchitecture({
      conversation: [{
        role: 'user',
        content: 'Crie um fluxo para aprovar um sinistro usando claim_id e o motivo da aprovacao.',
      }],
      currentSystemPrompt: null,
      tools: [approveClaim],
    }, new Error('invalid architecture'));

    const triage = fallback.nodes.find((node) => node.id === 'triagem');
    const capabilityRoute = triage?.routes?.find((route) => route.id.includes('insurance-approve-claim'));
    const collect = fallback.nodes.find((node) => node.id.includes('cap-coletar-insurance-approve-claim'));
    const confirmation = fallback.nodes.find((node) => node.id.includes('cap-confirmar-insurance-approve-claim'));

    expect(capabilityRoute?.targetNodeId).toBe(collect?.id);
    expect(collect?.kind).toBe('collect');
    expect(collect?.formFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: 'claim_id', required: true }),
      expect.objectContaining({ fieldKey: 'approval_reason', required: true }),
    ]));
    expect(confirmation?.kind).toBe('message');
    expect(confirmation?.subtitle).toContain('mcp:insurance:approve_claim');
  });

  it('compiles a complete deterministic proposal when the architecture model fails', () => {
    const approveClaim = highRiskMcpTool(
      'mcp:insurance:approve_claim',
      'Aprova um sinistro de seguro pelo claim_id informado.',
    );
    approveClaim.inputSchema = {
      type: 'object',
      required: ['claim_id', 'approval_reason'],
      properties: {
        claim_id: { type: 'string', title: 'Numero do sinistro' },
        approval_reason: { type: 'string', title: 'Motivo da aprovacao' },
      },
    };

    const proposal = buildDeterministicFallbackProposal({
      conversation: [{
        role: 'user',
        content: 'Crie um fluxo para aprovar um sinistro usando claim_id e o motivo da aprovacao.',
      }],
      currentSystemPrompt: null,
      tools: [approveClaim],
    }, new Error('invalid architecture'));
    const decision = proposal.flowGraph.nodes.find((node) => node.id === 'triagem');
    const collect = proposal.flowGraph.nodes.find((node) => node.id.includes('cap-coletar-insurance-approve-claim'));
    const confirmation = proposal.flowGraph.nodes.find((node) => node.id.includes('cap-confirmar-insurance-approve-claim'));
    const toolNode = proposal.flowGraph.nodes.find((node) => node.toolName === approveClaim.name);
    const agent = proposal.flowGraph.nodes.find((node) => node.kind === 'sub_agent');
    const capabilityRoute = decision?.config?.routes?.find((route) => route.id.includes('insurance-approve-claim'));
    const audit = auditAutopilotFlowGraph(proposal.flowGraph);

    expect(capabilityRoute?.targetNodeId).toBe(collect?.id);
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: decision?.id, target: collect?.id, routeId: capabilityRoute?.id }),
      expect.objectContaining({ source: collect?.id, target: confirmation?.id }),
      expect.objectContaining({ source: confirmation?.id, target: toolNode?.id }),
      expect.objectContaining({ source: toolNode?.id, target: agent?.id }),
    ]));
    expect(proposal.enabledToolNames).toContain(approveClaim.name);
    expect(toolNode?.config?.instructions).toContain('mcp:insurance:approve_claim');
    expect(audit.status).toBe('passed');
    expect(audit.issues).toEqual([]);
  });

  it('adds relevant qualified MCP tools to the graph when tool selection omits them', () => {
    const orderTool = mcpTool(
      'mcp:ecommerce:get_order_status',
      'Consulta status, rastreio e previsao de entrega de um pedido pelo numero do pedido.',
    );
    const architecture = {
      summary: 'Consultar status de pedido.',
      systemPrompt: 'Use @agente para consultar pedido.',
      nodes: [
        { id: 'inicio', kind: 'start' as const, title: 'Inicio', subtitle: 'Entrada', x: 120, y: 120 },
        { id: 'coletar-pedido', kind: 'collect' as const, title: 'Coletar pedido', subtitle: 'Numero do pedido', x: 380, y: 120 },
        { id: 'agente', kind: 'sub_agent' as const, title: 'Agente de pedidos', subtitle: 'Consulta externa', x: 640, y: 120 },
      ],
      edges: [
        { source: 'inicio', target: 'coletar-pedido' },
        { source: 'coletar-pedido', target: 'agente' },
      ],
    };
    const relevance = buildToolRelevanceMap({
      conversation: [{ role: 'user', content: 'Fluxo para status de pedido com rastreio.' }],
      architecture,
      tools: [orderTool],
    });

    const covered = ensureToolRelevanceCoverage(architecture, [orderTool], relevance);
    const toolNode = covered.nodes.find((node) => node.kind === 'tool' && node.toolName === 'mcp:ecommerce:get_order_status');

    expect(toolNode).toBeDefined();
    expect(toolNode?.subtitle).toContain('MCP qualificada: mcp:ecommerce:get_order_status');
    expect(toolNode?.instructions).toContain('Ferramenta real: mcp:ecommerce:get_order_status');
    expect(covered.edges).toEqual(expect.arrayContaining([
      { source: 'coletar-pedido', target: toolNode?.id },
    ]));
  });

  it('builds deterministic fallback architecture with order/protocol collection instead of generic lead fields', () => {
    const fallback = buildFallbackArchitecture({
      conversation: [
        { role: 'user', content: 'Crie um fluxo para consultar status de pedido e rastreio pelo protocolo.' },
      ],
      currentSystemPrompt: null,
    }, new Error('invalid architecture'));

    const triage = fallback.nodes.find((node) => node.id === 'triagem');
    const orderRoute = triage?.routes?.find((route) => route.id === 'status_pedido');
    const orderCollect = fallback.nodes.find((node) => node.id === 'coleta-pedido');

    expect(orderRoute?.targetNodeId).toBe('coleta-pedido');
    expect(orderCollect?.kind).toBe('collect');
    expect(orderCollect?.formFields?.map((field) => field.fieldKey)).toContain('order_or_request_id');
    expect(fallback.nodes.find((node) => node.id === 'coleta-dados')).toBeUndefined();
  });

  it('builds deterministic fallback architecture with scheduling-specific collection', () => {
    const fallback = buildFallbackArchitecture({
      conversation: [
        { role: 'user', content: 'Crie um fluxo para agendar e remarcar visitas com horario disponivel.' },
      ],
      currentSystemPrompt: null,
    }, new Error('invalid architecture'));

    const triage = fallback.nodes.find((node) => node.id === 'triagem');
    const schedulingRoute = triage?.routes?.find((route) => route.id === 'agendamento');
    const schedulingCollect = fallback.nodes.find((node) => node.id === 'coleta-agendamento');

    expect(schedulingRoute?.targetNodeId).toBe('coleta-agendamento');
    expect(schedulingCollect?.kind).toBe('collect');
    expect(schedulingCollect?.formFields?.map((field) => field.fieldKey)).toEqual(expect.arrayContaining([
      'date',
      'time',
      'objetivo',
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

  it('repairs decision routes that point to knowledge blocks before creating edges', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow com rota quebrada para knowledge.',
      systemPrompt: 'Use @triagem e responda com @agente.',
      nodes: [
        { id: 'inicio', kind: 'start', title: 'Inicio', subtitle: 'Entrada', x: 100, y: 100 },
        {
          id: 'triagem',
          kind: 'decision',
          title: 'Triagem',
          subtitle: 'Escolher rota',
          x: 320,
          y: 100,
          switchMode: 'ai',
          fallbackRouteId: 'fallback',
          routes: [
            {
              id: 'duvida',
              label: 'Duvida',
              description: 'Cliente tem uma pergunta que depende da base.',
              targetNodeId: 'base',
            },
            {
              id: 'fallback',
              label: 'Fallback',
              description: 'Baixa confianca ou outro assunto.',
              targetNodeId: 'base',
            },
          ],
        },
        { id: 'base', kind: 'knowledge', title: 'Base', subtitle: 'RAG', x: 540, y: 100 },
        { id: 'agente', kind: 'sub_agent', title: 'Agente', subtitle: 'Responder', x: 760, y: 100 },
      ],
      edges: [
        { source: 'inicio', target: 'triagem' },
        { source: 'triagem', target: 'base', routeId: 'duvida' },
        { source: 'base', target: 'agente' },
      ],
    }, []);

    const triagem = proposal.flowGraph.nodes.find((node) => node.id === 'triagem');
    const routeTargetId = triagem?.config?.routes?.find((route) => route.id === 'duvida')?.targetNodeId;

    expect(routeTargetId).toBe('agente');
    expect(proposal.flowGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'triagem', target: 'base' }),
    ]));
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'triagem', target: 'agente', routeId: 'duvida' }),
      expect.objectContaining({ source: 'base', target: 'agente' }),
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
