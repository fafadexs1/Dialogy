import type { ProcedureDocument } from './types';
import { evaluateStudioCondition } from './engine';
import { readStudioValue, type StudioDataContext } from './data-mapping';

/** Published business paths constrain capabilities; they do not select conversational intents. */
export function studioReasoningPaths(procedure: ProcedureDocument, context: StudioDataContext, completed: Set<string>, selected: Record<string, string> = {}) {
  const steps = [...procedure.steps].sort((a, b) => a.order - b.order);
  const reachable = new Set<string>();
  const decisions: Array<{ id: string; title: string; branches: NonNullable<typeof steps[number]['decisionBranches']>; waitingFor: string[] }> = [];
  const responses: string[] = [];
  const handoffs: Array<{ stepId: string; team: string | null; reason: string }> = [];
  let current: string | null | undefined = steps[0]?.id;
  while (current && !reachable.has(current)) {
    const step = steps.find((entry) => entry.id === current);
    if (!step) break;
    reachable.add(step.id);
    let next: string | null | undefined = step.nextStepId === undefined ? steps[steps.indexOf(step) + 1]?.id : step.nextStepId;
    if (['decision', 'validate_data'].includes(step.type)) {
      const branches = step.decisionBranches || [];
      const waitingFor = branches.flatMap((branch) => {
        if (!branch.condition) return [];
        const key = branch.condition.fieldKey;
        const producers = steps.filter((candidate) => (candidate.httpRequest?.outputMappings || candidate.mcpTool?.outputMappings || [])
          .some((output) => key === output.chipKey || key.startsWith(`${output.chipKey}.`)));
        if (producers.length && !producers.some((producer) => completed.has(producer.id))) return [key];
        if (['exists', 'not_exists'].includes(branch.condition.operator)) return [];
        try { return readStudioValue(context.values, key) === undefined ? [key] : []; }
        catch { return [key]; }
      });
      if (waitingFor.length) { decisions.push({ id: step.id, title: step.title, branches, waitingFor: [...new Set(waitingFor)] }); break; }
      let branch = branches.find((entry) => entry.condition && evaluateStudioCondition(entry.condition, context));
      const descriptive = branches.filter((entry) => !entry.condition && !entry.isDefault);
      const selectable = branches.filter((entry) => !entry.condition);
      if (!branch && descriptive.length) branch = selectable.find((entry) => entry.id === selected[step.id]);
      if (!branch && descriptive.length) { decisions.push({ id: step.id, title: step.title, branches: selectable, waitingFor: [] }); break; }
      branch ??= branches.find((entry) => entry.isDefault);
      if (!branch) { decisions.push({ id: step.id, title: step.title, branches, waitingFor: [] }); break; }
      if (branch.actionType === 'respond') {
        responses.push(branch.actionValue || branch.conditionLabel);
        next = branch.nextStepId ?? null;
      } else if (branch.actionType === 'handoff') {
        handoffs.push({ stepId: step.id, team: branch.actionValue || null, reason: branch.conditionLabel });
        next = null;
      }
      else next = branch.nextStepId ?? next;
    }
    if (step.type === 'handoff') handoffs.push({ stepId: step.id, team: step.handoffTeam || null, reason: step.handoffReason || step.title });
    if (['finish', 'handoff'].includes(step.type)) next = null;
    current = next;
  }
  return { reachable, decisions, responses, handoffs };
}
