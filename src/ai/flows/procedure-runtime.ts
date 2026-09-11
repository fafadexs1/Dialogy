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
import { StudioCollectionPlanSchema } from '@/services/agent-studio/collection-planner';
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
  mode: z.enum(['decision', 'response', 'collection_plan']),
  model: z.string().optional(),
  fixedModel: z.boolean().optional(),
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
  collectionPlan: StudioCollectionPlanSchema.optional(),
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
- Se TAREFA for "collection_plan", retorne apenas "collectionPlan" com o plano estruturado; não escreva response nem decision. A ordem das perguntas é decidida pelo objetivo, não pela posição dos campos.
- Se uma ferramenta falhou ou nao retornou sucesso, nao diga que a consulta/acao foi feita com sucesso.
- Se faltar dado essencial, peca esse dado de forma direta.
- Respeite escolhas, recusas e correcoes presentes no historico; nao reinicie descoberta ou recomendacao quando o cliente ja escolheu uma alternativa.
- Nao repita catalogos, listas, instrucoes ou perguntas que ja foram enviados, salvo se o cliente pedir explicitamente para repetir.
- "Nao precisa", "deixa pra la" e equivalentes interrompem a etapa atual; nunca trate essas frases como valor invalido de um campo.
- Nunca altere identificadores, numeros, precos ou contatos presentes nas fontes. Nao deduza especialidade ou setor pelo nome de uma pessoa.
- Regras especificas do negocio pertencem ao procedimento e as fontes autorizadas. Nao imponha triagem ou perguntas de outro setor.
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
Se nao houver seguranca, ofereca ajuda de um atendente humano. Nunca anuncie uma transferencia ou outra acao como iniciada ou concluida sem um resultado confirmado do sistema.
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
  outputKind?: 'procedure' | 'collection_plan';
  lmStudioConfig?: Awaited<ReturnType<typeof getGlobalLmStudioConfig>>;
}) {
  if (isLmStudioModel(input.model)) {
    return defineLmStudioPrompt(promptConfig, input.model, input.lmStudioConfig || { baseUrl: '', apiToken: '' }, input.outputKind || 'procedure');
  }

  if (isOpenAiCompatibleModel(input.model)) {
    return defineOpenAiCompatiblePrompt(promptConfig, input.model, input.apiKey, input.outputKind || 'procedure');
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
        modelCandidates: input.fixedModel ? [model] : getModelCandidates(input.model),
        apiKeyCandidates,
        maxAttemptsPerCandidate: Number.parseInt(process.env.AI_MODEL_MAX_ATTEMPTS || '', 10) || 2,
        retryBaseDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_BASE_DELAY_MS || '', 10) || 250,
        retryMaxDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_MAX_DELAY_MS || '', 10) || 1500,
        execute: async (context) => {
          const effectivePrompt = definePromptForCandidate({
            apiKey: context.apiKey,
            model: context.model,
            outputKind: input.mode === 'collection_plan' ? 'collection_plan' : 'procedure',
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

      if (input.mode === 'collection_plan') {
        const plan = StudioCollectionPlanSchema.safeParse(output.collectionPlan);
        return plan.success ? { collectionPlan: plan.data } : {};
      }
      if (input.mode === 'response' && output.response?.trim()) {
        return {
          response: formatCustomerFacingAiResponse(output.response.trim()),
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
