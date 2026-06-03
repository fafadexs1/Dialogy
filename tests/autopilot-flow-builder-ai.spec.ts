import { describe, expect, it } from 'vitest';

import {
  applyToolSelection,
  ensureOperationalCoverage,
  sanitizeAutopilotFlowProposal,
} from '@/ai/flows/autopilot-flow-builder';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';

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

  it('injects a principal assistant when the model omits one', () => {
    const proposal = sanitizeAutopilotFlowProposal({
      summary: 'Flow minimo.',
      systemPrompt: 'Ajude o cliente.',
      nodes: [{ id: 'entrada', kind: 'trigger', title: 'Entrada', subtitle: 'Inicio', x: 100, y: 100 }],
      edges: [],
    }, []);

    expect(proposal.flowGraph.nodes.some((node) => node.kind === 'assistant')).toBe(true);
    expect(proposal.flowGraph.nodes.every((node) => Boolean(node.config?.instructions?.trim()))).toBe(true);
  });

  it('repairs orphan knowledge, normalizes literal reference placeholders and keeps only one principal assistant', () => {
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
    expect(proposal.flowGraph.nodes.filter((node) => node.kind === 'assistant')).toHaveLength(1);
    const subAgent = proposal.flowGraph.nodes.find((node) => node.id === 'agent-sales');
    expect(subAgent).toMatchObject({
      kind: 'intent',
      config: {
        instructions: 'Apresente planos e colete os dados do cliente.',
        customIntentLabel: 'Raquel - Comercial',
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
  });

  it('prevents duplicate intent routes from creating unreachable sub-agents', () => {
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

    expect(proposal.flowGraph.nodes.find((node) => node.id === 'etapa-a')?.kind).toBe('intent');
    expect(proposal.flowGraph.nodes.find((node) => node.id === 'etapa-b')?.kind).toBe('understand');
  });

  it('does not invent deterministic message text for empty send_message blocks', () => {
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

    expect(proposal.flowGraph.nodes.find((node) => node.id === 'boas-vindas')?.config?.message).toBeUndefined();
  });

  it('adds only catalog tools explicitly selected after block analysis', () => {
    const architecture = {
      summary: 'Atendimento simples.',
      systemPrompt: 'Ajude o cliente.',
      nodes: [{ id: 'agente', kind: 'assistant' as const, title: 'Agente', subtitle: 'Principal', x: 100, y: 100 }],
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
        { id: 'agente', kind: 'assistant' as const, title: 'Agente', subtitle: 'Principal', x: 400, y: 200 },
        {
          id: 'comercial',
          kind: 'intent' as const,
          title: 'Comercial',
          subtitle: 'Coletar dados do lead',
          x: 700,
          y: 200,
          intent: 'purchase_inquiry' as const,
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
      { source: 'agente', target: crm?.id },
    ]));
    expect(repaired.edges).not.toEqual(expect.arrayContaining([
      { source: knowledge?.id, target: 'comercial' },
      { source: 'comercial', target: close?.id },
      { source: 'comercial', target: crm?.id },
    ]));
  });

  it('respects an explicit request for a flow without knowledge base', () => {
    const architecture = {
      summary: 'Flow sem base de conhecimento.',
      systemPrompt: 'Nao use RAG. Apenas envie uma mensagem fixa.',
      nodes: [{ id: 'agente', kind: 'assistant' as const, title: 'Agente', subtitle: 'Principal', x: 100, y: 100 }],
      edges: [],
    };

    const repaired = ensureOperationalCoverage(architecture, listAgentToolCatalogItems());

    expect(repaired.nodes.some((node) => node.kind === 'knowledge')).toBe(false);
  });
});
