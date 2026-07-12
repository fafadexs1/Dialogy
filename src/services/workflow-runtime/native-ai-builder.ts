import { z } from 'zod';

import { createWorkflowNode } from './catalog';
import type { ModelFallbackChain } from './model-adapter';
import { createNativeWorkflowTemplate } from './native-templates';
import { WorkflowDefinitionSchema } from './schemas';
import type { ModelConfiguration, WorkflowConnection, WorkflowDefinition } from './types';
import { validateWorkflowDefinition } from './validator';
import {
  buildNativeAgentToolConfig,
  getNativeAgentToolLabel,
  isNativeAgentToolEligible,
  listAttachedWorkflowToolNames,
  type NativeAgentToolCatalogItem,
} from './native-agent-tools';

const AiAgentBlueprintSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(160),
  persona: z.string().max(8_000).default(''),
  language: z.string().min(2).max(24).default('pt-BR'),
  objective: z.string().min(1).max(2_000),
  instructions: z.array(z.string().min(1).max(1_000)).min(1).max(16),
  completionCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(10),
  toolNames: z.array(z.string().min(1)).max(64).default([]),
  knowledgeDocumentIds: z.array(z.string().min(1)).max(128).default([]),
  knowledgeCollectionIds: z.array(z.string().min(1)).max(32).default([]),
});

export const NativeWorkflowAiBlueprintSchema = z.object({
  summary: z.string().min(1).max(2_000),
  architecture: z.enum(['single_agent', 'routed_team']),
  agents: z.array(AiAgentBlueprintSchema).min(1).max(2),
  router: z.object({
    minimumConfidence: z.number().min(0.5).max(0.99).default(0.75),
    routes: z.array(z.object({
      label: z.string().min(1).max(80),
      description: z.string().min(1).max(500),
      examples: z.array(z.string().min(1).max(300)).max(8).default([]),
    })).min(2).max(2),
  }).optional(),
  fallbackMessage: z.string().min(1).max(1_000),
  guardrailChecks: z.array(z.string().min(1).max(120)).min(1).max(12),
}).superRefine((value, context) => {
  if (value.architecture === 'single_agent' && value.agents.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['agents'], message: 'Agente unico exige exatamente um agente.' });
  }
  if (value.architecture === 'routed_team' && (value.agents.length !== 2 || !value.router)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['router'], message: 'Equipe roteada exige dois agentes e duas rotas.' });
  }
});

export type NativeWorkflowAiBlueprint = z.infer<typeof NativeWorkflowAiBlueprintSchema>;

export type NativeAiBuilderTool = Omit<NativeAgentToolCatalogItem, 'riskLevel'> & {
  riskLevel?: 'low' | 'medium' | 'high';
};

export type NativeWorkflowAiProposal = {
  summary: string;
  workflow: WorkflowDefinition;
  changes: string[];
  warnings: string[];
  validation: ReturnType<typeof validateWorkflowDefinition>;
  selectedToolNames: string[];
};

function connection(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  connectionType: WorkflowConnection['connectionType'],
): WorkflowConnection {
  return { id, sourceNodeId, sourcePortId, targetNodeId, targetPortId, connectionType };
}

function cleanId(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'tool';
}

function applyAgentBlueprint(
  workflow: WorkflowDefinition,
  agentId: string,
  knowledgeId: string,
  blueprint: z.infer<typeof AiAgentBlueprintSchema>,
) {
  const agent = workflow.nodes.find((node) => node.id === agentId);
  const knowledge = workflow.nodes.find((node) => node.id === knowledgeId);
  if (!agent || !knowledge) throw new Error(`Template nativo incompleto para ${agentId}.`);
  agent.name = blueprint.name;
  agent.config = {
    ...agent.config,
    name: blueprint.name,
    role: blueprint.role,
    persona: blueprint.persona,
    language: blueprint.language,
    objective: blueprint.objective,
    instructions: blueprint.instructions,
    completionCriteria: blueprint.completionCriteria,
  };
  knowledge.name = `Conhecimento de ${blueprint.name}`;
  knowledge.config = {
    ...knowledge.config,
    documentIds: blueprint.knowledgeDocumentIds,
    filters: blueprint.knowledgeCollectionIds.length > 0
      ? { collectionIds: blueprint.knowledgeCollectionIds }
      : {},
  };
}

function addTools(input: {
  workflow: WorkflowDefinition;
  agentId: string;
  requestedToolNames: string[];
  tools: NativeAiBuilderTool[];
  positionIndex: number;
}) {
  const catalog = new Map(input.tools.map((tool) => [
    tool.name,
    { ...tool, riskLevel: tool.riskLevel || 'low' } satisfies NativeAgentToolCatalogItem,
  ]));
  const rejected: string[] = [];
  const blocked: string[] = [];
  [...new Set(input.requestedToolNames)].forEach((toolName, index) => {
    const tool = catalog.get(toolName);
    if (!tool) {
      rejected.push(toolName);
      return;
    }
    if (!isNativeAgentToolEligible(tool)) {
      blocked.push(toolName);
      return;
    }
    const id = `ai_${cleanId(input.agentId)}_${cleanId(toolName)}_${index + 1}`;
    const node = createWorkflowNode(tool.source === 'mcp' ? 'tool.mcp' : 'tool.internal', {
      id,
      name: getNativeAgentToolLabel(tool),
      position: { x: 90 + input.positionIndex * 250, y: 720 + index * 125 },
      config: buildNativeAgentToolConfig(tool),
    });
    input.workflow.nodes.push(node);
    input.workflow.connections.push(connection(
      `${id}_attachment`, node.id, 'tool', input.agentId, 'tools', 'tool',
    ));
  });
  return { rejected, blocked };
}

export function materializeNativeWorkflowAiBlueprint(input: {
  configId: string;
  workspaceId: string;
  name: string;
  model: ModelConfiguration;
  blueprint: NativeWorkflowAiBlueprint;
  tools: NativeAiBuilderTool[];
  allowedKnowledgeDocumentIds: string[];
  allowedKnowledgeCollectionIds: string[];
}): NativeWorkflowAiProposal {
  const blueprint = NativeWorkflowAiBlueprintSchema.parse(input.blueprint);
  const workflow = createNativeWorkflowTemplate({
    configId: input.configId,
    workspaceId: input.workspaceId,
    name: input.name,
    model: input.model,
    persona: blueprint.agents[0]?.persona || '',
    language: blueprint.agents[0]?.language || 'pt-BR',
    template: blueprint.architecture,
  });

  const agentTargets = blueprint.architecture === 'single_agent'
    ? [{ agentId: 'primary_agent', knowledgeId: 'primary_knowledge' }]
    : [
        { agentId: 'support_agent', knowledgeId: 'support_knowledge' },
        { agentId: 'sales_agent', knowledgeId: 'sales_knowledge' },
      ];
  const warnings: string[] = [];
  const allowedDocumentIds = new Set(input.allowedKnowledgeDocumentIds);
  const allowedCollectionIds = new Set(input.allowedKnowledgeCollectionIds);
  blueprint.agents.forEach((agent, index) => {
    const target = agentTargets[index];
    const knowledgeDocumentIds = agent.knowledgeDocumentIds.filter((id) => allowedDocumentIds.has(id));
    const knowledgeCollectionIds = agent.knowledgeCollectionIds.filter((id) => allowedCollectionIds.has(id));
    const rejectedKnowledgeIds = [
      ...agent.knowledgeDocumentIds.filter((id) => !allowedDocumentIds.has(id)),
      ...agent.knowledgeCollectionIds.filter((id) => !allowedCollectionIds.has(id)),
    ];
    applyAgentBlueprint(workflow, target.agentId, target.knowledgeId, {
      ...agent,
      knowledgeDocumentIds,
      knowledgeCollectionIds,
    });
    if (rejectedKnowledgeIds.length > 0) {
      warnings.push(`Conhecimento ignorado por nao existir no catalogo autorizado: ${rejectedKnowledgeIds.join(', ')}.`);
    }
    const toolResult = addTools({
      workflow,
      agentId: target.agentId,
      requestedToolNames: agent.toolNames,
      tools: input.tools,
      positionIndex: index,
    });
    if (toolResult.rejected.length > 0) {
      warnings.push(`Ferramentas ignoradas por nao existirem no catalogo: ${toolResult.rejected.join(', ')}.`);
    }
    if (toolResult.blocked.length > 0) {
      warnings.push(`Ferramentas mantidas bloqueadas por nao serem elegiveis para execucao autonoma: ${toolResult.blocked.join(', ')}.`);
    }
  });

  const guardrail = workflow.nodes.find((node) => node.id === 'shared_guardrail');
  if (guardrail) guardrail.config = { ...guardrail.config, checks: blueprint.guardrailChecks };
  const fallbackNodes = workflow.nodes.filter((node) => (
    node.id === 'router_low_confidence' || node.id === 'router_default'
  ));
  fallbackNodes.forEach((node) => { node.config = { ...node.config, message: blueprint.fallbackMessage }; });

  if (blueprint.architecture === 'routed_team' && blueprint.router) {
    const router = workflow.nodes.find((node) => node.id === 'team_router');
    if (!router) throw new Error('Template de equipe sem AI Router.');
    router.config = {
      ...router.config,
      minimumConfidence: blueprint.router.minimumConfidence,
      routes: blueprint.router.routes.map((route, index) => ({
        id: index === 0 ? 'support' : 'sales',
        label: route.label,
        description: route.description,
        examples: route.examples,
      })),
    };
    router.outputPorts = router.outputPorts.map((port) => {
      if (port.id === 'support') return { ...port, label: blueprint.router!.routes[0].label };
      if (port.id === 'sales') return { ...port, label: blueprint.router!.routes[1].label };
      return port;
    });
  }

  workflow.updatedAt = new Date().toISOString();
  workflow.metadata = {
    ...(workflow.metadata || {}),
    source: 'native_ai_builder',
    aiBuilderSummary: blueprint.summary,
  };
  const parsedWorkflow = WorkflowDefinitionSchema.parse(workflow);
  const validation = validateWorkflowDefinition(parsedWorkflow);
  const materializedToolNames = listAttachedWorkflowToolNames(parsedWorkflow);
  const changes = [
    `${blueprint.agents.length} agente${blueprint.agents.length === 1 ? '' : 's'} configurado${blueprint.agents.length === 1 ? '' : 's'}.`,
    blueprint.architecture === 'routed_team' ? 'AI Router com fallback de baixa confianca configurado.' : 'Rota principal de atendimento configurada.',
    `${materializedToolNames.length} ferramenta${materializedToolNames.length === 1 ? '' : 's'} anexada${materializedToolNames.length === 1 ? '' : 's'}.`,
    'Modelo, memoria, RAG, guardrail, resposta, handoff e tratamento de erro conectados.',
  ];
  return {
    summary: blueprint.summary,
    workflow: parsedWorkflow,
    changes,
    warnings,
    validation,
    selectedToolNames: materializedToolNames,
  };
}

function promptForNativeBuilder(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow?: WorkflowDefinition | null;
  tools: NativeAiBuilderTool[];
  knowledgeDocuments: Array<{ id: string; name: string; collectionIds?: string[] }>;
  knowledgeCollections: Array<{ id: string; name: string; description?: string }>;
}) {
  const current = input.currentWorkflow ? {
    name: input.currentWorkflow.name,
    nodes: input.currentWorkflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      config: node.type === 'ai.agent' ? {
        role: node.config.role,
        persona: node.config.persona,
        language: node.config.language,
        objective: node.config.objective,
        instructions: node.config.instructions,
        completionCriteria: node.config.completionCriteria,
      } : undefined,
    })),
  } : null;
  return [
    'Conversa com o usuario:',
    JSON.stringify(input.conversation),
    'Workflow nativo atual (pode ser substituido pela proposta):',
    JSON.stringify(current),
    'Catalogo completo de ferramentas elegiveis do workspace (use somente nomes exatos desta lista e anexe todas as necessarias para cumprir o pedido):',
    JSON.stringify(input.tools.map((tool) => ({
      name: tool.name,
      displayName: getNativeAgentToolLabel({ ...tool, riskLevel: tool.riskLevel || 'low' }),
      description: tool.description,
      category: tool.category,
      source: tool.source,
      serverName: tool.serverName,
      riskLevel: tool.riskLevel || 'low',
      requiresConfirmation: tool.requiresHumanApproval === true || tool.riskLevel === 'high',
      allowedIntents: tool.allowedIntents,
      requiredSlots: tool.requiredSlots,
    }))),
    'Documentos permitidos (use somente IDs exatos):',
    JSON.stringify(input.knowledgeDocuments),
    'Colecoes permitidas (use somente IDs exatos):',
    JSON.stringify(input.knowledgeCollections),
    'Escolha single_agent para um especialista ou routed_team para exatamente dois especialistas. Nunca invente ferramenta, documento ou colecao. Persona, objetivo e comportamento pertencem a cada agente. Ferramentas de alto risco permanecem protegidas por confirmacao e so devem ser anexadas quando forem realmente necessarias. Sempre inclua guardrails no_opinionated_secrets e no_unconfirmed_tool_success quando apropriado.',
  ].join('\n\n');
}

export async function generateNativeWorkflowAiProposal(input: {
  configId: string;
  workspaceId: string;
  name: string;
  model: ModelConfiguration;
  modelChain: ModelFallbackChain;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow?: WorkflowDefinition | null;
  tools: NativeAiBuilderTool[];
  knowledgeDocuments: Array<{ id: string; name: string; collectionIds?: string[] }>;
  knowledgeCollections: Array<{ id: string; name: string; description?: string }>;
}) {
  const eligibleTools = input.tools.filter((tool) => isNativeAgentToolEligible({
    ...tool,
    riskLevel: tool.riskLevel || 'low',
  }));
  const result = await input.modelChain.generateStructured({
    schema: NativeWorkflowAiBlueprintSchema,
    schemaName: 'dialogy_native_workflow_ai_blueprint',
    messages: [
      {
        role: 'system',
        content: 'Voce e o arquiteto do Flowbuilder agent-first do Dialogy. Gere somente uma arquitetura segura e executavel no contrato solicitado. Toda entrega ao cliente deve ocorrer por Responder ou Handoff; agentes nunca respondem implicitamente. Uma execucao segue uma unica rota principal.',
      },
      { role: 'user', content: promptForNativeBuilder({ ...input, tools: eligibleTools }) },
    ],
    timeoutMs: 90_000,
  });
  const blueprint = NativeWorkflowAiBlueprintSchema.parse(result.output);
  const proposal = materializeNativeWorkflowAiBlueprint({
    configId: input.configId,
    workspaceId: input.workspaceId,
    name: input.name,
    model: input.model,
    blueprint,
    tools: eligibleTools,
    allowedKnowledgeDocumentIds: input.knowledgeDocuments.map((document) => document.id),
    allowedKnowledgeCollectionIds: input.knowledgeCollections.map((collection) => collection.id),
  });
  if (!proposal.validation.valid) {
    throw new Error(`A proposta da IA nao passou no validador: ${proposal.validation.errors.map((issue) => issue.message).join(' ')}`);
  }
  return proposal;
}
