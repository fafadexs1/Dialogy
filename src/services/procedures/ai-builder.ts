import { z } from 'zod';

import type { ModelFallbackChain } from '@/services/workflow-runtime/model-adapter';
import {
  PROCEDURE_INTENTS,
  PROCEDURE_STEP_TYPES,
  ProcedureStudioDocumentSchema,
  type ProcedureStudioDocument,
  type ProcedureStudioStep,
  type ProcedureToolOption,
} from './schemas';
import { simulateProcedureSuite } from './studio';
import { validateProcedureStudioDocument } from './validator';

const AiSlotSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  type: z.enum(['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean']).default('text'),
  required: z.boolean().default(true),
  aliases: z.array(z.string().min(1).max(80)).max(12).default([]),
}).strict();

const AiProcedureStepSchema = z.object({
  key: z.string().min(1).max(80),
  type: z.enum(PROCEDURE_STEP_TYPES),
  label: z.string().min(1).max(240),
  instruction: z.string().max(8_000).default(''),
  nextKey: z.string().max(80).nullable().default(null),
  requiredSlots: z.array(AiSlotSchema).max(20).default([]),
  toolName: z.string().max(300).nullable().default(null),
  toolPayloadTemplate: z.record(z.string().max(4_000)).default({}),
  requiresConfirmation: z.boolean().default(false),
  successKey: z.string().max(80).nullable().default(null),
  errorKey: z.string().max(80).nullable().default(null),
  branches: z.array(z.object({
    condition: z.string().min(1).max(1_000),
    nextKey: z.string().min(1).max(80),
  }).strict()).max(12).default([]),
  onFailure: z.enum(['retry', 'skip', 'abort', 'handoff']).default('handoff'),
  useLlm: z.boolean().default(false),
  requireGrounding: z.boolean().default(false),
}).strict();

export const ProcedureAiBlueprintSchema = z.object({
  summary: z.string().min(1).max(2_000),
  name: z.string().min(3).max(160),
  description: z.string().max(2_000).default(''),
  goal: z.string().min(3).max(1_000),
  priority: z.number().int().min(0).max(1_000).default(100),
  trigger: z.object({
    intents: z.array(z.enum(PROCEDURE_INTENTS)).min(1).max(8),
    phrases: z.array(z.string().min(3).max(300)).min(3).max(24),
    keywords: z.array(z.string().min(2).max(120)).max(30).default([]),
    exclusions: z.array(z.string().min(3).max(300)).min(2).max(20),
  }).strict(),
  steps: z.array(AiProcedureStepSchema).min(2).max(60),
}).strict();

export type ProcedureAiBlueprint = z.infer<typeof ProcedureAiBlueprintSchema>;

function cleanId(value: string, fallback: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || fallback;
}

function materializeStep(input: {
  step: z.infer<typeof AiProcedureStepSchema>;
  index: number;
  idByKey: Map<string, string>;
  toolByName: Map<string, ProcedureToolOption>;
  warnings: string[];
}): ProcedureStudioStep {
  const { step, index, idByKey, toolByName, warnings } = input;
  const id = idByKey.get(step.key)!;
  const nextStepId = step.nextKey ? idByKey.get(step.nextKey) || null : null;
  const base: ProcedureStudioStep = {
    id,
    order: index + 1,
    type: step.type,
    label: step.label,
    nextStepId,
  };
  if (step.type === 'gather_data') {
    return {
      ...base,
      requiredSlots: step.requiredSlots.filter((slot) => slot.required).map((slot) => cleanId(slot.key, 'information')),
      slotDefinitions: step.requiredSlots.map((slot) => ({
        ...slot,
        key: cleanId(slot.key, 'information'),
      })),
      promptTemplate: step.instruction,
      maxRetries: 2,
    };
  }
  if (step.type === 'retrieve_knowledge') {
    return {
      ...base,
      knowledgeQueryTemplate: step.instruction || '{{customer_message}}',
      requiredKnowledgeCoverage: step.requireGrounding ? 'high' : 'medium',
      onLowKnowledge: 'handoff',
    };
  }
  if (step.type === 'validate') {
    return { ...base, condition: step.instruction, onFail: step.onFailure };
  }
  if (step.type === 'decide') {
    return {
      ...base,
      decisionPrompt: step.instruction,
      branches: step.branches.flatMap((branch) => {
        const target = idByKey.get(branch.nextKey);
        return target ? [{ condition: branch.condition, nextStepId: target }] : [];
      }),
      nextStepId: null,
    };
  }
  if (step.type === 'tool_call') {
    const requestedName = step.toolName || '';
    const tool = toolByName.get(requestedName);
    if (!tool) warnings.push(`A ferramenta solicitada pela IA não existe ou não foi autorizada: ${requestedName || '(vazia)'}.`);
    const sensitive = tool?.requiresHumanApproval || tool?.riskLevel === 'high' || tool?.sideEffect === 'high';
    return {
      ...base,
      toolName: tool?.name || '',
      toolPayloadTemplate: step.toolPayloadTemplate,
      sideEffect: tool?.sideEffect || 'none',
      requiresConfirmation: Boolean(step.requiresConfirmation || sensitive),
      confirmationPrompt: sensitive
        ? step.instruction || `Confirme explicitamente antes de executar ${tool?.displayName || tool?.name}.`
        : undefined,
      successStepId: step.successKey ? idByKey.get(step.successKey) || null : nextStepId,
      errorStepId: step.errorKey ? idByKey.get(step.errorKey) || null : null,
      maxRetries: 1,
    };
  }
  if (step.type === 'respond') {
    return {
      ...base,
      responseTemplate: step.instruction,
      useLlm: step.useLlm,
      requireGrounding: step.requireGrounding,
      requiredKnowledgeCoverage: step.requireGrounding ? 'medium' : undefined,
    };
  }
  return { ...base, handoffReason: step.instruction, nextStepId: null };
}

export function materializeProcedureAiBlueprint(input: {
  configId: string;
  procedureId: string;
  blueprint: ProcedureAiBlueprint;
  tools: ProcedureToolOption[];
}): { procedure: ProcedureStudioDocument; warnings: string[] } {
  const blueprint = ProcedureAiBlueprintSchema.parse(input.blueprint);
  const warnings: string[] = [];
  const usedIds = new Set<string>();
  const idByKey = new Map<string, string>();
  blueprint.steps.forEach((step, index) => {
    const base = cleanId(step.key, `step_${index + 1}`);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}_${suffix++}`;
    usedIds.add(id);
    idByKey.set(step.key, id);
  });
  const toolByName = new Map(input.tools.filter((tool) => tool.enabled).map((tool) => [tool.name, tool]));
  const steps = blueprint.steps.map((step, index) => materializeStep({ step, index, idByKey, toolByName, warnings }));
  const procedure = ProcedureStudioDocumentSchema.parse({
    id: input.procedureId,
    configId: input.configId,
    name: blueprint.name,
    description: blueprint.description,
    goal: blueprint.goal,
    priority: blueprint.priority,
    trigger: blueprint.trigger,
    steps,
    metadata: { source: 'procedure_studio', createdBy: 'ai' },
  });
  return { procedure, warnings };
}

function promptForProcedure(input: {
  description: string;
  currentProcedure?: ProcedureStudioDocument | null;
  tools: ProcedureToolOption[];
}) {
  return [
    'Pedido do usuário:',
    input.description,
    'Procedimento atual, se houver:',
    JSON.stringify(input.currentProcedure || null),
    'Ferramentas habilitadas. Use somente o campo name exato:',
    JSON.stringify(input.tools.filter((tool) => tool.enabled).map((tool) => ({
      name: tool.name,
      label: tool.displayName || tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
      sideEffect: tool.sideEffect,
      requiresHumanApproval: tool.requiresHumanApproval,
      requiredSlots: tool.requiredSlots,
      inputSchema: tool.inputSchema,
    }))),
    [
      'Monte um procedimento conversacional completo e executável, como um playbook treinando um atendente excelente.',
      'Use chaves curtas e únicas em key/nextKey/successKey/errorKey. Toda chave referenciada precisa existir.',
      'Toda decisão precisa de ao menos duas branches e uma branch cujo condition comece com "Caso contrário".',
      'Toda tool_call precisa de successKey e errorKey. Nunca afirme sucesso antes do resultado real da ferramenta.',
      'Ferramentas de alto risco ou com side effect precisam de requiresConfirmation=true e uma instrução de confirmação clara.',
      'Colete cada dado antes de usá-lo. Em toolPayloadTemplate use {{nome_do_campo}}.',
      'Cada caminho deve terminar em respond ou handoff. Inclua pelo menos três frases de gatilho reais e duas exclusões.',
      'Não invente ferramentas, equipes, resultados, IDs ou integrações.',
    ].join('\n'),
  ].join('\n\n');
}

function repairMessage(error: unknown) {
  return [
    'A proposta anterior foi rejeitada. Reconstrua o blueprint inteiro e retorne apenas JSON válido.',
    `Motivo: ${error instanceof Error ? error.message.slice(0, 1_500) : String(error).slice(0, 1_500)}`,
    'Corrija todas as chaves, rotas de erro, confirmações, gatilhos e finais antes de responder.',
  ].join('\n');
}

export async function generateProcedureAiProposal(input: {
  configId: string;
  procedureId: string;
  description: string;
  currentProcedure?: ProcedureStudioDocument | null;
  tools: ProcedureToolOption[];
  modelChain: ModelFallbackChain;
}) {
  const messages = [
    {
      role: 'system' as const,
      content: 'Você é o arquiteto de Procedimentos Inteligentes do Dialogy. Gere playbooks seguros, auditáveis, conversacionais e determinísticos. A IA entende linguagem; o procedimento controla estado e ações.',
    },
    { role: 'user' as const, content: promptForProcedure(input) },
  ];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await input.modelChain.generateStructured({
        schema: ProcedureAiBlueprintSchema,
        schemaName: 'dialogy_procedure_blueprint',
        messages: attempt === 1 ? messages : [...messages, { role: 'user' as const, content: repairMessage(lastError) }],
        timeoutMs: 90_000,
      });
      const blueprint = ProcedureAiBlueprintSchema.parse(result.output);
      const materialized = materializeProcedureAiBlueprint({
        configId: input.configId,
        procedureId: input.procedureId,
        blueprint,
        tools: input.tools,
      });
      const validation = validateProcedureStudioDocument({ procedure: materialized.procedure, tools: input.tools });
      const simulation = simulateProcedureSuite({ procedure: materialized.procedure, tools: input.tools });
      if (!validation.valid || !simulation.passed) {
        throw new Error([
          ...validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
          ...simulation.cases.filter((item) => !item.passed).map((item) => `${item.name}: ${item.error}`),
        ].join('\n'));
      }
      return {
        summary: blueprint.summary,
        procedure: materialized.procedure,
        warnings: materialized.warnings,
        validation,
        simulation,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  throw lastError || new Error('A IA não gerou um procedimento válido.');
}
