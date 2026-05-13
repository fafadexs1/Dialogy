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
  process.env.AI_PROCEDURE_RUNTIME_MODEL || 'googleai/gemini-2.0-flash-lite',
  DEFAULT_AUTOPILOT_MODEL,
  'googleai/gemini-2.0-flash',
  'googleai/gemini-1.5-pro',
];

function getDefaultGeminiEnvKey(): string {
  return process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}

function getModelCandidates(model?: string): string[] {
  return [process.env.AI_PROCEDURE_RUNTIME_MODEL, ...PROCEDURE_MODEL_FALLBACKS, model]
    .filter((candidate, index, all): candidate is string => (
      Boolean(candidate?.trim()) && all.indexOf(candidate) === index
    ));
}

function definePromptForCandidate(input: {
  apiKey: string;
  model: string;
}) {
  const defaultEnvKey = getDefaultGeminiEnvKey();
  if (defaultEnvKey && defaultEnvKey === input.apiKey) {
    return globalPrompt;
  }

  const { genkit } = require('genkit');
  const { googleAI } = require('@genkit-ai/googleai');

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
    const configKey = input.config?.gemini_api_key?.trim();
    const workspaceKey = input.workspaceGeminiApiKey?.trim();
    const envKey = getDefaultGeminiEnvKey();
    const apiKeyCandidates: AiModelKeyCandidate[] = [
      { source: 'agent', key: configKey },
      { source: 'workspace', key: workspaceKey },
      { source: 'env', key: envKey && envKey !== 'no-key-configured' ? envKey : '' },
    ].filter((candidate): candidate is AiModelKeyCandidate => Boolean(candidate.key));

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
          });
          const result = await effectivePrompt(input, { model: context.model });
          assertAiModelOutput(result?.output, 'Procedure runtime slim returned no structured output.');
          return result;
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
