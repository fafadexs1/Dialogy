import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import type { WorkflowConnection } from '@/services/workflow-runtime/types';
import type { StudioFlowReleaseSummary } from '@/services/agent-studio/flow-contract';
import { studioFlowRelease } from './studio-flow-fixture';
import { createWorkflowEditorFixture } from './workflow-editor-fixture';

const release = studioFlowRelease();
export const studioCompositionPreviewReleases: StudioFlowReleaseSummary[] = [
  { agentId: release.agentId, agentName: release.agentSnapshot.name, releaseId: release.releaseId, version: 1, contract: release.flowContract!, procedures: [{ id: 'consulta', name: 'Consultar cadastro', description: 'Consulta o cadastro e devolve os dados públicos.' }] },
  { agentId: '20000000-0000-4000-8000-000000000002', agentName: 'Especialista financeiro', releaseId: '20000000-0000-4000-8000-000000000003', version: 2, contract: release.flowContract!, procedures: [{ id: 'consulta', name: 'Consultar faturas', description: 'Consulta informações financeiras autorizadas.' }] },
];

export function createStudioCompositionPreview() {
  const base = createWorkflowEditorFixture();
  const make = (type: string, id: string, name: string, x: number, y: number, config: Record<string, unknown> = {}) => createWorkflowNode(type, { id, name, position: { x, y }, config });
  const main = studioCompositionPreviewReleases[0], specialist = studioCompositionPreviewReleases[1];
  const nodes = [
    make('trigger.manual', 'start', 'Receber solicitação', 80, 200),
    make('ai.studio_agent', 'triage', 'Triagem · Studio v1', 520, 180, { agentId: main.agentId, releaseId: main.releaseId, mode: 'task', task: 'Entender a solicitação e consultar o especialista quando necessário.', outputKey: 'triagem', inputMappings: [{ inputKey: 'request', sourceType: 'input', sourcePath: 'message' }] }),
    make('output.end', 'end', 'Usar os resultados', 1080, 200),
    make('ai.model', 'model', 'IA Dialogy', 80, 520, { model: 'fixture', provider: 'openai', supportsStructuredOutput: true, supportsTools: true }),
    make('tool.studio_agent', 'financial', 'Especialista financeiro · Studio v2', 520, 680, { agentId: specialist.agentId, releaseId: specialist.releaseId, name: 'financeiro', description: 'Consultar o financeiro para assuntos de cobrança e faturas.' }),
    make('knowledge.rag_retriever', 'knowledge', 'Conhecimento autorizado', 80, 820),
  ];
  const edge = (id: string, sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string, connectionType: WorkflowConnection['connectionType'] = 'main'): WorkflowConnection => ({ id, sourceNodeId, sourcePortId, targetNodeId, targetPortId, connectionType });
  return { ...base, name: 'IA composta · demonstração local', workspaceId: undefined, nodes, connections: [edge('start-triage', 'start', 'started', 'triage', 'main'), edge('triage-end', 'triage', 'completed', 'end', 'main'), edge('model-triage', 'model', 'model', 'triage', 'model', 'model'), edge('financial-triage', 'financial', 'tool', 'triage', 'tools', 'tool'), edge('knowledge-triage', 'knowledge', 'knowledge', 'triage', 'knowledge', 'knowledge')] };
}
