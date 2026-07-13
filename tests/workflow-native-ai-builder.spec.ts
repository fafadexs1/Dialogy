import { describe, expect, it } from 'vitest';

import { getWorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import {
  materializeNativeWorkflowAiBlueprint,
  type NativeWorkflowAiBlueprint,
} from '@/services/workflow-runtime/native-ai-builder';
import type { ModelConfiguration } from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

const model: ModelConfiguration = {
  provider: 'fake',
  model: 'structured-model',
  temperature: 0.2,
  maxOutputTokens: 2_048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: false,
  timeoutMs: 60_000,
  maxRetries: 2,
};

function agent(name: string, role: string, toolNames: string[] = []) {
  return {
    name,
    role,
    persona: 'Acolhedor, objetivo e transparente.',
    language: 'pt-BR',
    objective: `Resolver solicitacoes de ${role} com seguranca.`,
    instructions: ['Use apenas dados e ferramentas conectados.'],
    completionCriteria: ['Responder, perguntar ou transferir explicitamente.'],
    toolNames,
    knowledgeDocumentIds: [`doc-${role}`],
    knowledgeCollectionIds: [role],
  };
}

function materialize(blueprint: NativeWorkflowAiBlueprint) {
  return materializeNativeWorkflowAiBlueprint({
    configId: 'config-1',
    workspaceId: 'workspace-1',
    name: 'Automacao criada com IA',
    model,
    blueprint,
    allowedKnowledgeDocumentIds: ['doc-suporte', 'doc-support', 'doc-billing'],
    allowedKnowledgeCollectionIds: ['suporte', 'support', 'billing'],
    tools: [
      {
        name: 'lookup_customer',
        displayName: 'Consultar cliente',
        description: 'Consulta o cadastro autorizado do cliente.',
        source: 'dialogy',
        version: '2026-07-12',
        class: 'read_only',
        riskLevel: 'low',
        sideEffect: 'none',
        idempotent: true,
        timeoutMs: 12_000,
        maxAttempts: 2,
        allowedIntents: ['support_request'],
        requiredSlots: ['customer_identifier'],
        fallbackAction: 'ask_missing_slot',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'close_chat',
        displayName: 'Encerrar atendimento',
        description: 'Ação interna de encerramento.',
        source: 'dialogy',
        riskLevel: 'medium',
        allowedIntents: ['support_request'],
      },
      {
        name: 'blocked_operation',
        description: 'Operação ainda não liberada para execução autônoma.',
        source: 'dialogy',
        riskLevel: 'medium',
        allowedIntents: [],
      },
      {
        name: 'mcp:billing:create_invoice',
        displayName: 'Criar fatura',
        description: 'Cria uma fatura depois de confirmacao explicita.',
        source: 'mcp',
        serverId: 'billing',
        serverName: 'Financeiro',
        version: 'mcp',
        class: 'write_non_idempotent',
        riskLevel: 'high',
        sideEffect: 'high',
        idempotent: false,
        timeoutMs: 45_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
    ],
  });
}

function expectNativeExecutableProposal(proposal: ReturnType<typeof materialize>) {
  expect(proposal.validation).toEqual(validateWorkflowDefinition(proposal.workflow));
  expect(proposal.validation.valid, proposal.validation.errors.map((issue) => issue.message).join('\n')).toBe(true);
  expect(proposal.workflow.metadata?.source).toBe('native_ai_builder');

  const nodeIds = proposal.workflow.nodes.map((node) => node.id);
  expect(new Set(nodeIds).size).toBe(nodeIds.length);
  for (const node of proposal.workflow.nodes) {
    expect(getWorkflowNodeManifest(node.type)?.availability).toBe('stable');
  }

  for (const workflowAgent of proposal.workflow.nodes.filter((node) => node.type === 'ai.agent')) {
    const incomingTypes = proposal.workflow.connections
      .filter((connection) => connection.targetNodeId === workflowAgent.id)
      .map((connection) => connection.connectionType);
    const outgoingPorts = proposal.workflow.connections
      .filter((connection) => connection.sourceNodeId === workflowAgent.id)
      .map((connection) => connection.sourcePortId);
    expect(incomingTypes).toContain('model');
    expect(outgoingPorts).toEqual(expect.arrayContaining(['completed', 'needs_input', 'handoff', 'error']));
  }
}

describe('native workflow AI builder', () => {
  it('rejects completion operations outside the server-owned receipt catalog', () => {
    const singleAgent = agent('Agente de suporte', 'suporte');
    expect(() => materialize({
      summary: 'Fluxo com operação inventada.',
      architecture: 'single_agent',
      agents: [{
        ...singleAgent,
        completionControl: {
          closeWhenComplete: true,
          requiredFields: [],
          requiredOperations: ['system:invented_receipt'] as any,
          allowFieldlessCompletion: false,
        },
      }],
      fallbackMessage: 'Pode detalhar um pouco mais?',
      guardrailChecks: ['no_secret_exposure'],
    })).toThrow();
  });

  it('materializes a valid single-agent proposal and ignores hallucinated tools', () => {
    const singleAgent = agent('Agente de suporte', 'suporte', [
      'lookup_customer',
      'close_chat',
      'blocked_operation',
      'tool_that_does_not_exist',
    ]);
    const proposal = materialize({
      summary: 'Atendimento de suporte com consulta de cadastro.',
      architecture: 'single_agent',
      agents: [{
        ...singleAgent,
        completionControl: {
          closeWhenComplete: true,
          requiredFields: ['name', 'CEP'],
          requiredOperations: ['system:contact_facts_persisted'],
          allowFieldlessCompletion: false,
        },
        knowledgeDocumentIds: [...singleAgent.knowledgeDocumentIds, 'doc-hallucinated'],
        knowledgeCollectionIds: [...singleAgent.knowledgeCollectionIds, 'collection-hallucinated'],
      }],
      fallbackMessage: 'Pode detalhar um pouco mais?',
      guardrailChecks: ['no_secret_exposure', 'no_unconfirmed_tool_success'],
    });

    expectNativeExecutableProposal(proposal);
    expect(proposal.selectedToolNames).toEqual(['lookup_customer']);
    expect(proposal.warnings.join(' ')).toContain('tool_that_does_not_exist');
    expect(proposal.warnings.join(' ')).toContain('blocked_operation');
    expect(proposal.warnings.join(' ')).toContain('close_chat');
    expect(proposal.warnings.join(' ')).toContain('mantidas bloqueadas');
    expect(proposal.warnings.join(' ')).toContain('doc-hallucinated');
    expect(proposal.warnings.join(' ')).toContain('collection-hallucinated');
    const internalTool = proposal.workflow.nodes.find((node) => node.type === 'tool.internal');
    expect(internalTool?.config).toMatchObject({
      name: 'lookup_customer',
      displayName: 'Consultar cliente',
      action: 'lookup_customer',
      version: '2026-07-12',
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      idempotent: true,
      timeoutMs: 12_000,
      maxAttempts: 2,
      allowedIntents: ['support_request'],
      requiredSlots: ['customer_identifier'],
      fallbackAction: 'ask_missing_slot',
    });
    expect(proposal.workflow.nodes.some((node) => node.config.name === 'blocked_operation')).toBe(false);
    expect(proposal.workflow.nodes.some((node) => node.config.name === 'close_chat')).toBe(false);
    const goal = proposal.workflow.nodes.find((node) => node.type === 'logic.goal_completion');
    const close = proposal.workflow.nodes.find((node) => node.type === 'output.close_conversation');
    expect(goal?.config).toMatchObject({
      requiredFields: ['name', 'CEP'],
      requiredOperations: ['system:contact_facts_persisted'],
      requireCompletionSignal: true,
      allowFieldlessCompletion: false,
    });
    expect(close).toBeDefined();
    expect(proposal.workflow.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'primary_agent', sourcePortId: 'completed', targetNodeId: goal!.id }),
      expect.objectContaining({ sourceNodeId: goal!.id, sourcePortId: 'completed', targetNodeId: close!.id }),
      expect.objectContaining({ sourceNodeId: close!.id, sourcePortId: 'completed', targetNodeId: 'primary_respond' }),
    ]));
    expect(proposal.workflow.connections.some((item) => (
      item.sourceNodeId === 'primary_agent'
      && item.sourcePortId === 'completed'
      && item.targetNodeId === 'primary_respond'
    ))).toBe(false);
    const knowledge = proposal.workflow.nodes.find((node) => node.id === 'primary_knowledge');
    expect(knowledge?.config.documentIds).toEqual(['doc-suporte']);
    expect(knowledge?.config.filters).toEqual({ collectionIds: ['suporte'] });
  });

  it('materializes a valid routed team with explicit router fallbacks and scoped tools', () => {
    const proposal = materialize({
      summary: 'Equipe de suporte e financeiro roteada por intencao.',
      architecture: 'routed_team',
      agents: [
        agent('Especialista de suporte', 'support', ['lookup_customer']),
        agent('Especialista financeiro', 'billing', ['mcp:billing:create_invoice']),
      ],
      router: {
        minimumConfidence: 0.8,
        routes: [
          { label: 'Suporte', description: 'Problemas tecnicos.', examples: ['Minha internet caiu'] },
          { label: 'Financeiro', description: 'Faturas e pagamentos.', examples: ['Preciso da segunda via'] },
        ],
      },
      fallbackMessage: 'Preciso de mais contexto para escolher o especialista.',
      guardrailChecks: ['no_secret_exposure', 'no_unconfirmed_tool_success'],
    });

    expectNativeExecutableProposal(proposal);
    expect(proposal.selectedToolNames).toEqual(['lookup_customer', 'mcp:billing:create_invoice']);
    expect(proposal.workflow.nodes.filter((node) => node.type === 'ai.agent')).toHaveLength(2);
    const router = proposal.workflow.nodes.find((node) => node.type === 'logic.ai_router');
    expect(router).toBeDefined();
    const routerOutputs = proposal.workflow.connections
      .filter((connection) => connection.sourceNodeId === router!.id)
      .map((connection) => connection.sourcePortId);
    expect(routerOutputs).toEqual(expect.arrayContaining(['support', 'sales', 'default', 'low_confidence', 'error']));

    const sensitiveTool = proposal.workflow.nodes.find((node) => node.type === 'tool.mcp');
    expect(sensitiveTool?.config.requiresConfirmation).toBe(true);
    expect(sensitiveTool?.config.requiresHumanApproval).toBe(true);
    expect(sensitiveTool?.config.riskLevel).toBe('high');
    expect(sensitiveTool?.config.serverName).toBe('Financeiro');
    expect(sensitiveTool?.config.timeoutMs).toBe(45_000);
    expect(sensitiveTool?.config.allowedTools).toEqual(['create_invoice']);
    expect(sensitiveTool?.config.permissionScope).toBe('automations:execute_sensitive_tool');
  });
});
