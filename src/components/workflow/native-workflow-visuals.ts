import type { WorkflowNodeCategory } from '@/services/workflow-runtime/catalog';
import type { ConnectionType } from '@/services/workflow-runtime/types';

export const NATIVE_WORKFLOW_SHELL_CLASS =
  'workflow-editor relative flex h-full min-h-0 w-full overflow-hidden';

export const NATIVE_WORKFLOW_CONNECTION_META: Record<ConnectionType, { label: string; color: string; dashed: boolean }> = {
  main: { label: 'Execução', color: '#74869c', dashed: false },
  error: { label: 'Erro', color: '#dc2626', dashed: false },
  event: { label: 'Evento', color: '#d97706', dashed: false },
  model: { label: 'Modelo', color: '#7c3aed', dashed: true },
  memory: { label: 'Memória', color: '#9333ea', dashed: true },
  knowledge: { label: 'Conhecimento', color: '#ea580c', dashed: true },
  tool: { label: 'Ferramenta', color: '#db2777', dashed: true },
  agent_tool: { label: 'Agente', color: '#0891b2', dashed: true },
  guardrail: { label: 'Guardrail', color: '#059669', dashed: true },
};

export const NATIVE_WORKFLOW_CATEGORY_COLOR: Record<WorkflowNodeCategory, string> = {
  triggers: '#6388c4',
  interaction: '#b77a42',
  data: '#5489b8',
  logic: '#ad8635',
  ai: '#9272c0',
  knowledge_memory: '#a57250',
  tools: '#b36e8b',
  integrations: '#448e99',
  utilities: '#658b82',
  output: '#3e9a73',
  error: '#bc6570',
};
