import type { WorkflowNodeCategory } from '@/services/workflow-runtime/catalog';
import type { ConnectionType } from '@/services/workflow-runtime/types';

export const NATIVE_WORKFLOW_SHELL_CLASS =
  'relative flex h-full min-h-0 w-full overflow-hidden bg-[#080d14] text-slate-100';

export const NATIVE_WORKFLOW_CONNECTION_META: Record<ConnectionType, { label: string; color: string; dashed: boolean }> = {
  main: { label: 'Execução', color: '#38bdf8', dashed: false },
  error: { label: 'Erro', color: '#fb7185', dashed: false },
  event: { label: 'Evento', color: '#fbbf24', dashed: false },
  model: { label: 'Modelo', color: '#a78bfa', dashed: true },
  memory: { label: 'Memória', color: '#c084fc', dashed: true },
  knowledge: { label: 'Conhecimento', color: '#fb923c', dashed: true },
  tool: { label: 'Ferramenta', color: '#f87171', dashed: true },
  agent_tool: { label: 'Agente', color: '#22d3ee', dashed: true },
  guardrail: { label: 'Guardrail', color: '#34d399', dashed: true },
};

export const NATIVE_WORKFLOW_CATEGORY_COLOR: Record<WorkflowNodeCategory, string> = {
  triggers: '#22d3ee',
  data: '#60a5fa',
  logic: '#fbbf24',
  ai: '#a78bfa',
  knowledge_memory: '#fb923c',
  tools: '#f87171',
  output: '#34d399',
  error: '#fb7185',
};
