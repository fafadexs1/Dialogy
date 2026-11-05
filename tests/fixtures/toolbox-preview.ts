import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';
import { createWorkflowEditorFixture } from './workflow-editor-fixture';

export function createToolboxPreview(): WorkflowDefinition {
  const definition = createWorkflowEditorFixture();
  definition.id = 'toolbox-preview'; definition.workspaceId = undefined; definition.name = 'Ferramentas · dados sintéticos';
  const make = (type: string, id: string, name: string, x: number, config: Record<string, unknown> = {}) => createWorkflowNode(type, { id, name, position: { x, y: 120 }, config });
  const start = make('trigger.manual', 'input', 'Dados de entrada', 0);
  const filter = make('data.operation', 'filter', 'Filtrar leads ativos', 360, { operation: 'filter', source: '{{input.leads}}', field: 'active', operator: 'equals', value: true, outputKey: 'qualified' });
  const http = make('integration.http_request', 'api', 'Consultar catálogo', 720, { url: 'https://api.example.com/catalog', responseFormat: 'json', pagination: { mode: 'cursor', itemsPath: 'items', nextCursorPath: 'next', maxPages: 10, maxItems: 1000, timeoutMs: 60000 } });
  const file = make('files.write', 'export', 'Exportar resultados', 1080, { format: 'csv', source: '{{variables.qualified}}', fileName: 'leads.csv' });
  const end = make('output.end', 'end', 'Concluir', 1440);
  definition.nodes = [start, filter, http, file, end];
  const link = (source: WorkflowNode, target: WorkflowNode) => ({ id: `${source.id}_${target.id}`, sourceNodeId: source.id, sourcePortId: source.outputPorts.find(port => port.connectionType === 'main')!.id, targetNodeId: target.id, targetPortId: 'main', connectionType: 'main' as const });
  definition.connections = [link(start, filter), link(filter, http), link(http, file), link(file, end)];
  return definition;
}
