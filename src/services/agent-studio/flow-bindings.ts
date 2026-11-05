import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';
import type { AgentReleaseManifest } from './types';
import { isStudioFlowNode, publishedStudioFlowContract } from './flow-contract';
import { StudioFlowInputMappingsSchema } from './flow-inputs';
import { readStudioValue } from './data-mapping';

export function validateStudioCompositionBinding(definition: WorkflowDefinition, node: WorkflowNode, release: AgentReleaseManifest) {
  if (!isStudioFlowNode(node.type)) return;
  if (release.workspaceId !== definition.workspaceId || release.agentId !== node.config.agentId || release.releaseId !== node.config.releaseId) throw new Error('Publicação fora do escopo do fluxo.');
  const contract = publishedStudioFlowContract(release);
  const mode = node.type.startsWith('tool.') ? 'task' : String(node.config.mode || 'task');
  if (!contract.modes.includes(mode as 'task' | 'conversation')) throw new Error(`O modo de “${node.name}” não é autorizado pelo Studio.`);
  if (node.type.endsWith('studio_procedure') && (!contract.exposedProcedureIds.includes(String(node.config.procedureId)) || !release.publishedProcedures.some((procedure) => procedure.id === node.config.procedureId))) throw new Error(`Selecione uma habilidade exportada em “${node.name}”.`);
  const mappings = StudioFlowInputMappingsSchema.parse(node.config.inputMappings || []);
  const destinations = new Set<string>();
  for (const mapping of mappings) {
    if (!contract.inputs.some((field) => field.key === mapping.inputKey) || destinations.has(mapping.inputKey) || !mapping.sourcePath.trim()) throw new Error(`Revise os mapeamentos de “${node.name}”.`);
    destinations.add(mapping.inputKey);
    if (mapping.sourceType !== 'static') readStudioValue({}, mapping.sourcePath);
  }
  if (!node.type.startsWith('tool.') && mode === 'task' && contract.inputs.some((field) => field.required && !destinations.has(field.key))) throw new Error(`Mapeie todas as entradas obrigatórias de “${node.name}”.`);
  for (const connection of definition.connections.filter((edge) => edge.targetNodeId === node.id)) {
    if (['model', 'tool', 'knowledge', 'memory'].includes(connection.connectionType) && !contract.extensions.includes(connection.connectionType === 'tool' ? 'tools' : connection.connectionType as 'model' | 'knowledge' | 'memory')) throw new Error(`A publicação de “${node.name}” não autoriza a conexão ${connection.connectionType}.`);
  }
  for (const [key, minimum, maximum] of [['maxModelCalls', 1, contract.maxModelCalls], ['maxToolCalls', 0, contract.maxToolCalls], ['timeoutMs', 1000, contract.timeoutMs]] as const) {
    const value = node.config[key];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum)) throw new Error(`Os limites de “${node.name}” excedem os publicados no Studio.`);
  }
}

export function assertStudioDelegationAcyclic(definition: WorkflowDefinition) {
  const adjacency = new Map<string, string[]>();
  for (const edge of definition.connections.filter((connection) => connection.connectionType === 'tool')) {
    const specialist = definition.nodes.find((node) => node.id === edge.sourceNodeId);
    const parent = definition.nodes.find((node) => node.id === edge.targetNodeId);
    if (specialist?.type === 'tool.studio_agent' && parent?.type === 'ai.studio_agent' && specialist.config.releaseId === parent.config.releaseId) throw new Error('Um agente não pode delegar para a própria versão.');
    if (specialist && parent) adjacency.set(parent.id, [...(adjacency.get(parent.id) || []), specialist.id]);
  }
  const visit = (id: string, stack: Set<string>) => {
    if (stack.has(id)) throw new Error('Há um ciclo entre especialistas.');
    const next = new Set(stack).add(id);
    for (const child of adjacency.get(id) || []) visit(child, next);
  };
  for (const id of adjacency.keys()) visit(id, new Set());
}
