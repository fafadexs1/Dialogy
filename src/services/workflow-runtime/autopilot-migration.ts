import type { AutopilotFlowGraph } from '@/lib/types';
import { compileAutopilotFlowToWorkflow } from './autopilot-compat';
import { createWorkflowNode } from './catalog';
import type { ModelConfiguration, WorkflowConnection, WorkflowDefinition } from './types';
import { hashValue } from './utils';
import { validateWorkflowDefinition } from './validator';

export type AutopilotNativeMigrationInput = {
  configId: string;
  workspaceId: string;
  name: string;
  graph: AutopilotFlowGraph;
  model: ModelConfiguration;
  persona?: string | null;
  existingDefinition?: WorkflowDefinition | null;
  existingSourceHash?: string | null;
};

function connection(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  connectionType: WorkflowConnection['connectionType'] = 'main',
): WorkflowConnection {
  return { id, sourceNodeId, sourcePortId, targetNodeId, targetPortId, connectionType };
}

function addMissingAgentOutcomeBranches(workflow: WorkflowDefinition) {
  const errorHandler = workflow.nodes.find((node) => node.type === 'error.handler');
  const agents = workflow.nodes.filter((node) => node.type === 'ai.agent');
  for (const [index, agent] of agents.entries()) {
    const prefix = `migration_${agent.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const addResponseBranch = (
      output: 'needs_input' | 'limit_reached',
      title: string,
      message: string,
      yOffset: number,
    ) => {
      if (workflow.connections.some((item) => item.sourceNodeId === agent.id && item.sourcePortId === output)) return;
      const respond = createWorkflowNode('output.respond', {
        id: `${prefix}_${output}_respond`,
        name: title,
        position: { x: agent.position.x + 300, y: agent.position.y + yOffset },
        config: { message, channel: 'source', idempotent: true },
      });
      const end = createWorkflowNode('output.end', {
        id: `${prefix}_${output}_end`,
        name: `Finalizar ${title.toLowerCase()}`,
        position: { x: agent.position.x + 580, y: agent.position.y + yOffset },
      });
      workflow.nodes.push(respond, end);
      workflow.connections.push(
        connection(`${prefix}_${output}`, agent.id, output, respond.id, 'main'),
        connection(`${prefix}_${output}_done`, respond.id, 'success', end.id, 'main'),
      );
      if (errorHandler) {
        workflow.connections.push(connection(
          `${prefix}_${output}_error`,
          respond.id,
          'error',
          errorHandler.id,
          'error',
          'error',
        ));
      }
    };

    addResponseBranch('needs_input', 'Pedir informação', '{{current.question}}', 160 + (index * 40));
    addResponseBranch('limit_reached', 'Informar limite', '{{current.response}}', 300 + (index * 40));

    if (!workflow.connections.some((item) => item.sourceNodeId === agent.id && item.sourcePortId === 'handoff')) {
      const handoff = createWorkflowNode('output.respond', {
        id: `${prefix}_handoff`,
        name: 'Transferência ainda não configurada',
        position: { x: agent.position.x + 300, y: agent.position.y + 440 + (index * 40) },
        config: {
          message: 'Não consegui encaminhar automaticamente agora porque a equipe de destino ainda não foi configurada.',
          channel: 'source',
          idempotent: true,
        },
      });
      const end = createWorkflowNode('output.end', {
        id: `${prefix}_handoff_end`,
        name: 'Finalizar sem transferência',
        position: { x: agent.position.x + 580, y: agent.position.y + 440 + (index * 40) },
      });
      workflow.nodes.push(handoff, end);
      workflow.connections.push(
        connection(`${prefix}_handoff_route`, agent.id, 'handoff', handoff.id, 'main'),
        connection(`${prefix}_handoff_done`, handoff.id, 'success', end.id, 'main'),
      );
    }
  }
}

export function previewAutopilotNativeMigration(input: AutopilotNativeMigrationInput) {
  const sourceHash = hashValue({
    graph: input.graph,
    persona: input.persona || '',
    model: input.model,
  });
  if (
    input.existingDefinition
    && input.existingSourceHash === sourceHash
  ) {
    return {
      workflow: structuredClone(input.existingDefinition),
      validation: validateWorkflowDefinition(input.existingDefinition),
      sourceHash,
      reused: true,
      changes: ['A migração existente já corresponde ao grafo legado atual.'],
      warnings: [],
    };
  }

  const workflow = compileAutopilotFlowToWorkflow({
    configId: input.configId,
    workspaceId: input.workspaceId,
    name: input.name,
    graph: input.graph,
    version: 'draft',
    model: input.model,
  });
  workflow.status = 'draft';
  const primaryAgent = workflow.nodes.find((node) => node.type === 'ai.agent');
  if (primaryAgent) {
    primaryAgent.config.persona = input.persona || '';
    primaryAgent.config.language = 'pt-BR';
  }
  addMissingAgentOutcomeBranches(workflow);
  workflow.metadata = {
    ...(workflow.metadata || {}),
    source: 'legacy_flow_graph_migration',
    editorVersion: 2,
    sourceHash,
  };
  workflow.updatedAt = new Date().toISOString();
  const validation = validateWorkflowDefinition(workflow);
  return {
    workflow,
    validation,
    sourceHash,
    reused: false,
    changes: [
      `${workflow.nodes.filter((node) => !node.type.startsWith('tool.')).length} blocos convertidos para o runtime nativo.`,
      `${workflow.nodes.filter((node) => node.type.startsWith('tool.')).length} ferramentas convertidas em capacidades anexadas.`,
      'Persona atual copiada integralmente para o agente principal.',
      'Rotas de pergunta e limite tornadas explícitas; transferência fica segura até uma equipe ser configurada.',
    ],
    warnings: validation.warnings.map((issue) => issue.message),
  };
}
