'use server';

/**
 * Slim AI flow for Procedure Runtime.
 *
 * This intentionally avoids the full auto-responder prompt. Procedure steps
 * already carry the relevant KB instruction, so this flow receives only the
 * active procedure state, compact tool results, and recent chat context.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { formatCustomerFacingAiResponse } from '@/lib/ai-response-format';
import { logAutopilotUsage } from '@/actions/autopilot';
import {
  assertAiModelOutput,
  runAiModelWithFallback,
  type AiModelKeyCandidate,
} from '@/services/ai/model-client';
import {
  coerceLmStudioPromptOutput,
  defineLmStudioPrompt,
  getGlobalLmStudioConfig,
  isLmStudioModel,
} from '@/services/ai/lm-studio';
import {
  coerceOpenAiCompatiblePromptOutput,
  defineOpenAiCompatiblePrompt,
  isOpenAiCompatibleModel,
} from '@/services/ai/openai-compatible';
import {
  getDefaultGeminiEnvKey,
  resolveAiProviderKeyCandidates,
} from '@/services/ai/provider-keys';

const BranchOptionSchema = z.object({
  condition: z.string(),
  nextStepId: z.string(),
});

const ProcedureRuntimeInputSchema = z.object({
  config: z.any(),
  workspaceGeminiApiKey: z.string().optional(),
  chatId: z.string(),
  mode: z.enum(['decision', 'response']),
  model: z.string().optional(),
  customerMessage: z.string(),
  chatHistory: z.string().optional(),
  persona: z.string().optional(),
  fallbackReply: z.string().optional(),
  escalationPolicy: z.string().optional(),
  contact: z.any().optional(),
  procedure: z.object({
    id: z.string().optional(),
    name: z.string(),
    currentStepId: z.string().optional(),
    stepLabel: z.string().optional(),
    prompt: z.string(),
    branchOptions: z.array(BranchOptionSchema).optional(),
    collectedSlots: z.record(z.string()).optional(),
    decisions: z.record(z.string()).optional(),
    toolResults: z.array(z.record(z.any())).optional(),
  }),
});

const ProcedureRuntimeOutputSchema = z.object({
  decision: z.string().optional().nullable(),
  response: z.string().optional().nullable(),
});

export type ProcedureRuntimeOutput = z.infer<typeof ProcedureRuntimeOutputSchema>;
export type ProcedureRuntimeInput = z.infer<typeof ProcedureRuntimeInputSchema>;

const promptConfig = {
  name: 'procedureRuntimeSlimPrompt',
  input: { schema: ProcedureRuntimeInputSchema },
  output: { schema: ProcedureRuntimeOutputSchema },
  prompt: `Voce e o Procedure Runtime Slim do Dialogy.
Use somente os dados abaixo. Nao invente consulta, status, valor, protocolo ou acao.

TAREFA: {{mode}}

Regras obrigatorias:
- Se TAREFA for "decision", retorne apenas o campo JSON "decision" com uma das opcoes permitidas exatamente como escrita.
- Se TAREFA for "response", retorne apenas o campo JSON "response" com uma resposta curta, natural e objetiva para WhatsApp.
- Se uma ferramenta falhou ou nao retornou sucesso, nao diga que a consulta/acao foi feita com sucesso.
- Se faltar dado essencial, peca esse dado de forma direta.
- Nunca prescreva ou calcule dosagem de medicamento. Se o cliente pedir dose, gotas, ml ou mg, diga que nao pode orientar dosagem por seguranca e siga a triagem.
- Nunca peca peso com a finalidade de calcular dose de remedio.
- Nunca cite SAMU, ambulancia, 192, 193 ou 911. Em urgencia, use apenas "pronto atendimento fisico", "pronto-socorro fisico" ou "unidade de saude mais proxima".
- Nao solicite actions. O executor ja cuida de ferramentas.

Persona curta:
{{#if persona}}
{{{persona}}}
{{else}}
Atendente virtual profissional, claro e objetivo.
{{/if}}

Procedimento:
- Nome: {{procedure.name}}
- Passo atual: {{procedure.currentStepId}} / {{procedure.stepLabel}}
- Instrucao do passo: {{{procedure.prompt}}}

Opcoes permitidas para decision:
{{#if procedure.branchOptions}}
{{#each procedure.branchOptions}}
- {{condition}}
{{/each}}
{{else}}
(nenhuma)
{{/if}}

Slots coletados:
{{json procedure.collectedSlots}}

Decisoes anteriores:
{{json procedure.decisions}}

Resultados compactos de ferramentas:
{{json procedure.toolResults}}

Contato:
{{json contact}}

Historico recente:
{{#if chatHistory}}
{{{chatHistory}}}
{{else}}
(sem historico recente)
{{/if}}

Politica de escalonamento:
{{#if escalationPolicy}}
{{{escalationPolicy}}}
{{else}}
Se nao houver seguranca, diga que vai envolver um atendente humano.
{{/if}}

Mensagem atual do cliente:
{{{customerMessage}}}
`,
};

const globalPrompt = ai.definePrompt(promptConfig);
const PROCEDURE_MODEL_FALLBACKS = [
  process.env.AI_PROCEDURE_RUNTIME_MODEL || 'googleai/gemini-2.5-flash',
  DEFAULT_AUTOPILOT_MODEL,
  'codex/gpt-5.3-codex',
  'openai/gpt-5.5',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-v4-flash',
  'googleai/gemini-3.1-flash-lite',
  'googleai/gemini-2.5-flash-lite',
  'googleai/gemini-2.5-pro',
];

function normalizeRuntimeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function asksMedicationDosage(value: string): boolean {
  const text = normalizeRuntimeText(value);
  return (
    /\b(quant[ao]s?|dose|dosagem|gotas?|gotinha|ml|mg)\b/.test(text) &&
    /\b(dipirona|paracetamol|ibuprofeno|remedio|medicamento|antitermico|antiinflamatorio|antibiotico|dar|dou|posso dar)\b/.test(text)
  );
}

function responseStillHandlesMedicationDosageSafely(response: string): boolean {
  const text = normalizeRuntimeText(response);
  return (
    /\b(nao posso|nao consigo|nao devo|nao e seguro|por seguranca)\b/.test(text) &&
    /\b(dosagem|dose|medicamento|remedio|gotas?)\b/.test(text)
  );
}

function sanitizeProcedureRuntimeResponse(response: string, input: ProcedureRuntimeInput): string {
  let sanitized = response
    .replace(/\bSAMU\b/gi, 'pronto atendimento fisico')
    .replace(/\bambul[aâ]ncia\b/gi, 'pronto atendimento fisico')
    .replace(/\b(?:192|193|911)\b/g, 'pronto atendimento fisico');

  const normalized = normalizeRuntimeText(sanitized);
  const unsafeDosageContinuation = asksMedicationDosage(input.customerMessage) && (
    !responseStillHandlesMedicationDosageSafely(sanitized) ||
    /\b(peso|kg|quilo)\b.*\b(dose|dosagem|gotas?|ml|mg)\b/.test(normalized) ||
    /\b(dose|dosagem|gotas?|ml|mg)\b.*\b(peso|kg|quilo)\b/.test(normalized)
  );

  if (unsafeDosageContinuation) {
    sanitized = [
      'Nao posso orientar dosagem de medicamento por aqui por seguranca.',
      'A dose correta depende de avaliacao medica e dados clinicos da crianca.',
      'Para seguir com seguranca, qual e a idade da crianca e ha quanto tempo a febre comecou?',
    ].join(' ');
  }

  sanitized = repairPediatricSchedulingFallback(sanitized, input);

  return sanitized;
}

function isPediatricProcedure(input: ProcedureRuntimeInput): boolean {
  const text = normalizeRuntimeText([
    input.config?.name,
    input.procedure?.name,
    input.procedure?.stepLabel,
    input.persona,
    input.procedure?.prompt,
  ].filter(Boolean).join(' '));
  return /\b(roberta|pediatr|crianca|crianca|filh[ao]|bebe)\b/.test(text);
}

function looksLikeGenericSchedulingPrompt(response: string): boolean {
  const text = normalizeRuntimeText(response);
  return /^para continuar me informe (?:data e horario|horario|data)\.?$/.test(text) ||
    /\bme informe (?:data e horario|horario|data)\b/.test(text) && text.length <= 90 ||
    /\b(nao consigo consultar|verificar disponibilidade|consultar disponibilidade|vou encaminhar|vou envolver|atendente humano|equipe pediatras|equipe responsavel)\b/.test(text);
}

function hasSchedulingPreference(text: string): boolean {
  return /\b(prefiro|pode ser|quero|manha|tarde|noite|hoje|amanha|cedo|rotina|eletiv|urgente|horario|periodo)\b/.test(text);
}

function inferPediatricScheduleClass(text: string): 'azul' | 'amarelo' | null {
  const hasBlueSignal = (
    /\b(sem febre|nao tem febre|temperatura normal)\b/.test(text) &&
    /\b(respiracao normal|sem cansaco|nao esta cansad[ao]|sem falta de ar)\b/.test(text) &&
    /\b(ativa|ativo|brincando|comeu|comendo|alimenta|urinando normal|urinou normal|urina normal)\b/.test(text)
  ) || (
    /\b(tosse leve|coriza clara|espirrando|espirros)\b/.test(text) &&
    /\b(sem febre|respiracao normal|ativa|ativo|brincando)\b/.test(text)
  );
  if (hasBlueSignal) return 'azul';

  const hasYellowSignal = (
    /\b(38\s*[5-9]|39|40|41|42)\b/.test(text) &&
    /\b(36|48|anteontem|dois dias|2 dias|persistente)\b/.test(text)
  ) || (
    /\b(vomitou|vomito|vomitos|diarreia)\b/.test(text) &&
    /\b(aceita agua|aceitando agua|pequenos goles|urinou|fez xixi|sem olhos fundos|nao tem boca seca)\b/.test(text)
  );
  if (hasYellowSignal) return 'amarelo';

  return null;
}

function repairPediatricSchedulingFallback(response: string, input: ProcedureRuntimeInput): string {
  if (!isPediatricProcedure(input) || !looksLikeGenericSchedulingPrompt(response)) return response;

  const conversation = normalizeRuntimeText([
    input.chatHistory,
    input.customerMessage,
  ].filter(Boolean).join('\n'));

  if (/\b(agendar|agendamento|marcar consulta|marcar)\b/.test(conversation) && !/\b(febre|tosse|coriza|vomit|diarreia|respir|dor|sintoma)\b/.test(conversation)) {
    return 'Compreendo a pressa, mas preciso fazer uma triagem curta para direcionar com seguranca. A consulta e para uma crianca? Qual e a idade e o motivo principal do atendimento?';
  }

  if (!hasSchedulingPreference(conversation)) return response;

  const scheduleClass = inferPediatricScheduleClass(conversation);
  if (scheduleClass === 'azul') {
    return 'Perfeito. Pelo que voce informou, o quadro segue como leve, entao vamos continuar com o agendamento de uma consulta eletiva/de rotina. Para concluir, qual dia fica melhor?';
  }

  if (scheduleClass === 'amarelo') {
    return 'Perfeito. Pelo que voce informou, o caso precisa de consulta urgente, idealmente hoje ou no maximo amanha. Para concluir, qual horario especifico fica melhor?';
  }

  return response;
}

function getModelCandidates(model?: string): string[] {
  if (isLmStudioModel(model)) {
    return [model!];
  }

  return [process.env.AI_PROCEDURE_RUNTIME_MODEL, model, ...PROCEDURE_MODEL_FALLBACKS]
    .filter((candidate, index, all): candidate is string => (
      Boolean(candidate?.trim()) && all.indexOf(candidate) === index
    ));
}

function definePromptForCandidate(input: {
  apiKey: string;
  model: string;
  lmStudioConfig?: Awaited<ReturnType<typeof getGlobalLmStudioConfig>>;
}) {
  if (isLmStudioModel(input.model)) {
    return defineLmStudioPrompt(promptConfig, input.model, input.lmStudioConfig || { baseUrl: '', apiToken: '' }, 'procedure');
  }

  if (isOpenAiCompatibleModel(input.model)) {
    return defineOpenAiCompatiblePrompt(promptConfig, input.model, input.apiKey, 'procedure');
  }

  const defaultEnvKey = getDefaultGeminiEnvKey();
  if (defaultEnvKey && defaultEnvKey === input.apiKey) {
    return globalPrompt;
  }

  const { genkit } = require('genkit');
  const { googleAI } = require('@genkit-ai/google-genai');

  const dynamicAi = genkit({
    plugins: [googleAI({ apiKey: input.apiKey })],
    model: input.model,
  });

  return dynamicAi.definePrompt(promptConfig);
}

const procedureRuntimeFlow = ai.defineFlow(
  {
    name: 'procedureRuntimeSlimFlow',
    inputSchema: ProcedureRuntimeInputSchema,
    outputSchema: ProcedureRuntimeOutputSchema,
  },
  async (input) => {
    const model = input.model || DEFAULT_AUTOPILOT_MODEL;
    const lmStudioConfig = isLmStudioModel(model) ? await getGlobalLmStudioConfig() : null;
    const apiKeyCandidates: AiModelKeyCandidate[] = isLmStudioModel(model)
      ? [{ source: 'lmstudio-superadmin', key: lmStudioConfig?.apiToken || 'lm-studio', provider: 'lmstudio' }]
      : await resolveAiProviderKeyCandidates({
          config: input.config,
          workspaceGeminiApiKey: input.workspaceGeminiApiKey,
        });

    if (apiKeyCandidates.length === 0) {
      console.error('[PROCEDURE_RUNTIME_SLIM] Nenhuma chave de API encontrada.');
      return {};
    }

    try {
      const promptRun = await runAiModelWithFallback({
        label: 'procedureRuntimeSlimFlow',
        modelCandidates: getModelCandidates(input.model),
        apiKeyCandidates,
        maxAttemptsPerCandidate: Number.parseInt(process.env.AI_MODEL_MAX_ATTEMPTS || '', 10) || 2,
        retryBaseDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_BASE_DELAY_MS || '', 10) || 250,
        retryMaxDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_MAX_DELAY_MS || '', 10) || 1500,
        execute: async (context) => {
          const effectivePrompt = definePromptForCandidate({
            apiKey: context.apiKey,
            model: context.model,
            lmStudioConfig: lmStudioConfig || undefined,
          });
          const result = await effectivePrompt(input, { model: context.model });
          let finalResult = result;
          if (isLmStudioModel(context.model)) {
            const parsedOutput = coerceLmStudioPromptOutput<ProcedureRuntimeOutput & Record<string, unknown>>(
              result?.output,
              result?.text
            );
            if (parsedOutput) {
              finalResult = Object.create(result);
              Object.defineProperty(finalResult, 'output', {
                value: parsedOutput,
                writable: true,
                enumerable: true,
                configurable: true,
              });
            }
          }
          if (isOpenAiCompatibleModel(context.model)) {
            const parsedOutput = coerceOpenAiCompatiblePromptOutput<ProcedureRuntimeOutput & Record<string, unknown>>(
              finalResult?.output,
              finalResult?.text
            );
            if (parsedOutput) {
              finalResult = Object.create(finalResult || {});
              Object.defineProperty(finalResult, 'output', {
                value: parsedOutput,
                writable: true,
                enumerable: true,
                configurable: true,
              });
            }
          }
          assertAiModelOutput(finalResult?.output, 'Procedure runtime slim returned no structured output.');
          return finalResult;
        },
      });

      const output = promptRun.result.output || {};
      if (promptRun.result.usage && input.config?.id) {
        logAutopilotUsage({
          configId: input.config.id,
          flowName: 'procedureRuntimeSlimFlow',
          modelName: promptRun.model,
          inputTokens: promptRun.result.usage.inputTokens ?? 0,
          outputTokens: promptRun.result.usage.outputTokens ?? 0,
          totalTokens: promptRun.result.usage.totalTokens ?? 0,
          ruleName: input.mode,
        }).catch((error) => {
          console.error('[PROCEDURE_RUNTIME_SLIM_USAGE_LOG_ERROR]', error);
        });
      }

      if (input.mode === 'response' && output.response?.trim()) {
        const sanitizedResponse = sanitizeProcedureRuntimeResponse(output.response.trim(), input);
        return {
          response: formatCustomerFacingAiResponse(sanitizedResponse),
        };
      }

      if (input.mode === 'decision' && output.decision?.trim()) {
        return {
          decision: output.decision.trim(),
        };
      }

      return {};
    } catch (error) {
      console.error('[PROCEDURE_RUNTIME_SLIM] Prompt failed:', error);
      return {};
    }
  },
);

export async function generateProcedureRuntimeOutput(input: ProcedureRuntimeInput): Promise<ProcedureRuntimeOutput> {
  return procedureRuntimeFlow(input);
}
