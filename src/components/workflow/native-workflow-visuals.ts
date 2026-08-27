import type { WorkflowNodeCategory } from '@/services/workflow-runtime/catalog';
import type { ConnectionType } from '@/services/workflow-runtime/types';

export const NATIVE_WORKFLOW_SHELL_CLASS =
  'dark relative flex h-full min-h-0 w-full overflow-hidden bg-[#070b10] text-slate-100';

export const NATIVE_WORKFLOW_CONNECTION_META: Record<ConnectionType, { label: string; color: string; dashed: boolean }> = {
  main: { label: 'Execução', color: '#1e293b', dashed: false },
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
  triggers: '#7890a0',
  interaction: '#9d7f68',
  data: '#71859d',
  logic: '#a18e63',
  ai: '#89819b',
  knowledge_memory: '#9d7f68',
  tools: '#9c747b',
  integrations: '#718f97',
  utilities: '#7e8790',
  output: '#759184',
  error: '#a87373',
};
