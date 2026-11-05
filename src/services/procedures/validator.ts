import type {
  ProcedureStudioDocument,
  ProcedureStudioStep,
  ProcedureToolOption,
} from './schemas';
import { ProcedureStudioDocumentSchema } from './schemas';

export type ProcedureValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  stepId?: string;
  field?: string;
};

export type ProcedureValidationResult = {
  valid: boolean;
  errors: ProcedureValidationIssue[];
  warnings: ProcedureValidationIssue[];
  reachableStepIds: string[];
  terminalStepIds: string[];
  score: number;
};

const DEFAULT_BRANCH = /^(default|fallback|otherwise|else|sen[aã]o|caso contr[aá]rio|qualquer outro)/i;
const TEMPLATE_VARIABLE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function outgoingStepIds(step: ProcedureStudioStep): string[] {
  return Array.from(new Set([
    step.nextStepId,
    step.successStepId,
    step.errorStepId,
    ...(step.branches || []).map((branch) => branch.nextStepId),
  ].filter((value): value is string => Boolean(value))));
}

function collectTemplateVariables(step: ProcedureStudioStep): string[] {
  const values = [
    step.promptTemplate,
    step.knowledgeQueryTemplate,
    step.condition,
    step.decisionPrompt,
    step.responseTemplate,
    step.confirmationPrompt,
    step.handoffReason,
    ...Object.values(step.toolPayloadTemplate || {}),
  ].filter((value): value is string => Boolean(value));
  const variables = new Set<string>();
  for (const value of values) {
    TEMPLATE_VARIABLE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TEMPLATE_VARIABLE.exec(value))) variables.add(match[1]);
  }
  return [...variables];
}

function pushIssue(
  target: ProcedureValidationIssue[],
  severity: ProcedureValidationIssue['severity'],
  code: string,
  message: string,
  step?: ProcedureStudioStep,
  field?: string,
) {
  target.push({ code, severity, message, stepId: step?.id, field });
}

export function validateProcedureStudioDocument(input: {
  procedure: ProcedureStudioDocument;
  tools?: ProcedureToolOption[];
}): ProcedureValidationResult {
  const errors: ProcedureValidationIssue[] = [];
  const warnings: ProcedureValidationIssue[] = [];
  const parsed = ProcedureStudioDocumentSchema.safeParse(input.procedure);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: 'schema_invalid',
        severity: 'error',
        message: `${issue.path.join('.') || 'procedimento'}: ${issue.message}`,
        field: issue.path.join('.'),
      });
    }
    return { valid: false, errors, warnings, reachableStepIds: [], terminalStepIds: [], score: 0 };
  }

  const procedure = parsed.data;
  const steps = [...procedure.steps].sort((a, b) => a.order - b.order);
  const stepById = new Map<string, ProcedureStudioStep>();
  const toolByName = new Map((input.tools || []).map((tool) => [tool.name, tool]));
  const collectedSlots = new Set<string>(['customer_message']);

  for (const step of steps) {
    if (stepById.has(step.id)) pushIssue(errors, 'error', 'duplicate_step_id', `A peça "${step.label}" repete o ID ${step.id}.`, step, 'id');
    stepById.set(step.id, step);
    for (const slot of step.requiredSlots || []) collectedSlots.add(slot);
  }

  const orders = new Set<number>();
  for (const step of steps) {
    if (orders.has(step.order)) pushIssue(errors, 'error', 'duplicate_step_order', `Duas peças usam a posição ${step.order}.`, step, 'order');
    orders.add(step.order);
    for (const targetId of outgoingStepIds(step)) {
      if (!stepById.has(targetId)) {
        pushIssue(errors, 'error', 'missing_step_target', `A rota da peça "${step.label}" aponta para uma peça inexistente (${targetId}).`, step);
      }
    }

    if (step.type === 'gather_data') {
      if ((step.requiredSlots || []).length === 0 && !step.promptTemplate?.trim()) {
        pushIssue(errors, 'error', 'gather_without_input', 'A peça Perguntar precisa de ao menos um campo ou uma pergunta aberta.', step);
      }
      const definitions = new Map((step.slotDefinitions || []).map((slot) => [slot.key, slot]));
      for (const slot of step.requiredSlots || []) {
        if (!definitions.has(slot)) pushIssue(warnings, 'warning', 'slot_without_definition', `O campo ${slot} não tem rótulo e tipo configurados.`, step);
      }
    }

    if (step.type === 'retrieve_knowledge' && !step.knowledgeQueryTemplate?.trim()) {
      pushIssue(errors, 'error', 'knowledge_without_query', 'A peça Consultar conhecimento precisa dizer o que buscar.', step);
    }

    if (step.type === 'validate' && !step.condition?.trim()) {
      pushIssue(errors, 'error', 'validation_without_condition', 'A peça Verificar precisa de uma condição.', step);
    }

    if (step.type === 'decide') {
      if ((step.branches || []).length < 2) {
        pushIssue(errors, 'error', 'decision_without_branches', 'A peça Decidir precisa de pelo menos dois caminhos.', step);
      } else if (!(step.branches || []).some((branch) => DEFAULT_BRANCH.test(branch.condition))) {
        pushIssue(errors, 'error', 'decision_without_fallback', 'Toda decisão precisa de um caminho "Caso contrário".', step);
      }
    }

    if (step.type === 'tool_call') {
      if (!step.toolName?.trim()) {
        pushIssue(errors, 'error', 'tool_missing', 'A peça Executar precisa escolher uma ferramenta/API.', step);
      } else {
        const tool = toolByName.get(step.toolName);
        if (input.tools && !tool) pushIssue(errors, 'error', 'tool_unknown', `A ferramenta ${step.toolName} não existe no catálogo autorizado.`, step);
        if (tool && !tool.enabled) pushIssue(errors, 'error', 'tool_disabled', `A ferramenta ${tool.displayName || tool.name} ainda não está habilitada neste agente.`, step);
        const sensitive = tool?.requiresHumanApproval || tool?.riskLevel === 'high' || tool?.sideEffect === 'high' || step.sideEffect === 'high';
        if (sensitive && !step.requiresConfirmation) {
          pushIssue(errors, 'error', 'confirmation_required', `A ação ${tool?.displayName || step.toolName} tem efeito sensível e exige confirmação explícita.`, step);
        }
      }
      if (!step.errorStepId) {
        pushIssue(errors, 'error', 'tool_without_error_route', 'Toda chamada de API precisa de um caminho de falha explícito.', step);
      }
      if (!step.successStepId && !step.nextStepId) {
        pushIssue(errors, 'error', 'tool_without_success_route', 'Toda chamada de API precisa de um próximo passo de sucesso.', step);
      }
    }

    if (step.type === 'respond' && !step.responseTemplate?.trim()) {
      pushIssue(errors, 'error', 'response_empty', 'A peça Responder precisa de uma mensagem ou instrução.', step);
    }

    if (step.type === 'handoff' && !step.handoffReason?.trim()) {
      pushIssue(errors, 'error', 'handoff_without_reason', 'A peça Encaminhar precisa explicar o motivo e a equipe de destino.', step);
    }

  }

  const reachable = new Set<string>();
  const visiting = new Set<string>();
  let hasCycle = false;
  const first = steps[0];
  const visit = (stepId: string) => {
    if (visiting.has(stepId)) {
      hasCycle = true;
      return;
    }
    if (reachable.has(stepId)) return;
    const step = stepById.get(stepId);
    if (!step) return;
    reachable.add(stepId);
    visiting.add(stepId);
    outgoingStepIds(step).forEach(visit);
    visiting.delete(stepId);
  };
  if (first) visit(first.id);

  const definiteSlotsBefore = new Map<string, Set<string>>();
  if (first) definiteSlotsBefore.set(first.id, new Set(['customer_message']));
  const dataflowQueue = first ? [first.id] : [];
  while (dataflowQueue.length > 0) {
    const stepId = dataflowQueue.shift()!;
    const step = stepById.get(stepId);
    const before = definiteSlotsBefore.get(stepId);
    if (!step || !before) continue;
    const after = new Set(before);
    if (step.type === 'gather_data') {
      for (const slot of step.requiredSlots || []) after.add(slot);
    }
    for (const targetId of outgoingStepIds(step)) {
      const existing = definiteSlotsBefore.get(targetId);
      const merged = existing
        ? new Set([...existing].filter((slot) => after.has(slot)))
        : new Set(after);
      const changed = !existing
        || existing.size !== merged.size
        || [...existing].some((slot) => !merged.has(slot));
      if (changed) {
        definiteSlotsBefore.set(targetId, merged);
        dataflowQueue.push(targetId);
      }
    }
  }

  for (const step of steps) {
    const available = definiteSlotsBefore.get(step.id) || new Set(['customer_message']);
    for (const variable of collectTemplateVariables(step)) {
      if (available.has(variable)) continue;
      if (step.type === 'tool_call' && Object.values(step.toolPayloadTemplate || {}).some((value) => value.includes(`{{${variable}}}`))) {
        pushIssue(errors, 'error', 'unsafe_tool_payload_variable', `A API usa {{${variable}}}, mas esse dado não foi coletado em todos os caminhos que chegam à peça.`, step, 'toolPayloadTemplate');
      } else if (!collectedSlots.has(variable)) {
        pushIssue(warnings, 'warning', 'unknown_template_variable', `A variável {{${variable}}} não é coletada por nenhuma peça conhecida.`, step);
      } else {
        pushIssue(warnings, 'warning', 'conditional_template_variable', `A variável {{${variable}}} pode não existir em todos os caminhos que chegam à peça.`, step);
      }
    }
  }

  if (hasCycle) pushIssue(errors, 'error', 'cycle_detected', 'O procedimento possui um ciclo sem um bloco de loop controlado.');
  for (const step of steps) {
    if (!reachable.has(step.id)) pushIssue(errors, 'error', 'unreachable_step', `A peça "${step.label}" está desconectada do início.`, step);
  }

  const terminalStepIds = steps
    .filter((step) => outgoingStepIds(step).length === 0 || step.type === 'handoff')
    .map((step) => step.id);
  if (terminalStepIds.length === 0) pushIssue(errors, 'error', 'terminal_missing', 'O procedimento precisa de ao menos uma saída final.');
  for (const terminalId of terminalStepIds) {
    const terminal = stepById.get(terminalId)!;
    if (!['respond', 'handoff'].includes(terminal.type)) {
      pushIssue(warnings, 'warning', 'weak_terminal', `O caminho termina em "${terminal.label}" sem responder nem encaminhar o cliente.`, terminal);
    }
  }

  if (procedure.trigger.exclusions.length === 0) {
    pushIssue(warnings, 'warning', 'trigger_without_exclusions', 'Adicione exemplos de quando este procedimento não deve iniciar para reduzir falsos positivos.');
  }
  if (procedure.trigger.phrases.length < 3) {
    pushIssue(warnings, 'warning', 'few_trigger_examples', 'Use pelo menos três frases reais de clientes para melhorar o disparo.');
  }

  const score = Math.max(0, Math.min(100, 100 - errors.length * 14 - warnings.length * 3));
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reachableStepIds: [...reachable],
    terminalStepIds,
    score,
  };
}
