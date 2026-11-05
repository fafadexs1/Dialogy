import { advanceStudioSession, createStudioSession, type StudioEngineDependencies, type StudioSession } from './engine';
import type { AgentReleaseManifest } from './types';
import type { StudioDataContext } from './data-mapping';
import type { StudioFlowOutcome } from './flow-execution';
import { publishedStudioFlowContract, projectStudioFlowData } from './flow-contract';

/** Runs the immutable published procedure through the existing Studio procedure engine. */
export async function runStudioFlowProcedure(input: {
  release: AgentReleaseManifest; procedureId: string; state?: StudioSession;
  invocationId: string; messageId: string; message: string;
  data: Record<string, unknown>; contact?: Record<string, unknown>;
  dependencies: StudioEngineDependencies;
  requireExport?: boolean;
}): Promise<{ state: StudioSession; result: StudioFlowOutcome }> {
  const contract = publishedStudioFlowContract(input.release);
  if (input.requireExport !== false && !contract.exposedProcedureIds.includes(input.procedureId)) throw new Error('Habilidade não exportada por esta versão do Studio.');
  const procedure = input.release.publishedProcedures.find((entry) => entry.id === input.procedureId && entry.status !== 'archived');
  if (!procedure) throw new Error('Procedimento publicado indisponível.');
  const original = input.release.agentSnapshot;
  const document = {
    ...original,
    resolveStage: { ...original.resolveStage, conversationMode: 'guided' as const, procedures: [procedure] },
    // A composed invocation returns control; it never closes or transfers a chat itself.
    concludeStage: { ...original.concludeStage, confirmResolutionQuestion: '', successClosingMessage: '' },
  };
  const state = input.state || createStudioSession(input.release.agentId, input.release.releaseId, input.invocationId);
  const context: Omit<StudioDataContext, 'values'> = { input: input.data, contact: input.contact };
  const result = await advanceStudioSession({ document, state, message: input.message, messageId: input.messageId, context,
    dependencies: { ...input.dependencies, chooseProcedure: async () => procedure.id,
      handoff: async () => ({ message: 'Encaminhamento solicitado ao fluxo.' }),
    },
  });
  const status = result.state.status === 'resolved' ? 'completed' : result.state.status === 'transferred' ? 'handoff' : result.state.status === 'failed' || result.state.status === 'cancelled' ? 'error' : 'needs_input';
  const data = status === 'completed' ? projectStudioFlowData(contract.outputs, result.state.values) : {};
  return { state: result.state, result: { status, response: result.response, data } };
}
