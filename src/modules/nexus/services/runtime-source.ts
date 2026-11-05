import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
export function toolboxSource(input: NodeRuntimeInput) {
  return { ...input.execution.variables, input: input.execution.input, current: input.input, variables: input.execution.variables, context: input.execution.context, nodeResults: input.execution.nodeResults };
}
