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
        description: 'Consulta o cadastro autorizado do cliente.',
        source: 'dialogy',
        riskLevel: 'low',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'mcp:billing:create_invoice',
        description: 'Cria uma fatura depois de confirmacao explicita.',
        source: 'mcp',
        serverId: 'billing',
        riskLevel: 'high',
        requiresHumanApproval: true,
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
  it('materializes a valid single-agent proposal and ignores hallucinated tools', () => {
    const singleAgent = agent('Agente de suporte', 'suporte', ['lookup_customer', 'tool_that_does_not_exist']);
    const proposal = materialize({
      summary: 'Atendimento de suporte com consulta de cadastro.',
      architecture: 'single_agent',
      agents: [{
        ...singleAgent,
        knowledgeDocumentIds: [...singleAgent.knowledgeDocumentIds, 'doc-hallucinated'],
        knowledgeCollectionIds: [...singleAgent.knowledgeCollectionIds, 'collection-hallucinated'],
      }],
      fallbackMessage: 'Pode detalhar um pouco mais?',
      guardrailChecks: ['no_secret_exposure', 'no_unconfirmed_tool_success'],
    });

    expectNativeExecutableProposal(proposal);
    expect(proposal.selectedToolNames).toEqual(['lookup_customer']);
    expect(proposal.warnings.join(' ')).toContain('tool_that_does_not_exist');
    expect(proposal.warnings.join(' ')).toContain('doc-hallucinated');
    expect(proposal.warnings.join(' ')).toContain('collection-hallucinated');
    expect(proposal.workflow.nodes.some((node) => node.type === 'tool.internal')).toBe(true);
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
    expect(proposal.workflow.nodes.filter((node) => node.type === 'ai.agent')).toHaveLength(2);
    const router = proposal.workflow.nodes.find((node) => node.type === 'logic.ai_router');
    expect(router).toBeDefined();
    const routerOutputs = proposal.workflow.connections
      .filter((connection) => connection.sourceNodeId === router!.id)
      .map((connection) => connection.sourcePortId);
    expect(routerOutputs).toEqual(expect.arrayContaining(['support', 'sales', 'default', 'low_confidence', 'error']));

    const sensitiveTool = proposal.workflow.nodes.find((node) => node.type === 'tool.mcp');
    expect(sensitiveTool?.config.requiresConfirmation).toBe(true);
  });
});
