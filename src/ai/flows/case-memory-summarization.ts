import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { logAutopilotUsage } from '@/actions/autopilot';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import {
  isLmStudioModel,
} from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';

const CaseMemoryInputSchema = z.object({
  workspaceId: z.string(),
  chatHistory: z.string(),
  closeReasonLabel: z.string().optional(),
  closeNotes: z.string().optional(),
  contactName: z.string().optional(),
  channel: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  autopilotConfigId: z.string().optional(),
});

const CaseMemoryOutputSchema = z.object({
  shouldStore: z.boolean().describe('True when the case has enough signal to be reused in future support conversations.'),
  summary: z.string().describe('A concise summary of the case.'),
  problem: z.string().describe('The customer problem in one or two sentences.'),
  resolution: z.string().describe('How the issue was resolved or what procedure should be followed.'),
  outcome: z.string().describe('The final result of the case.'),
  keywords: z.array(z.string()).max(10).describe('Operational keywords for retrieval.'),
});

export type CaseMemoryInput = z.infer<typeof CaseMemoryInputSchema>;
export type CaseMemoryOutput = z.infer<typeof CaseMemoryOutputSchema>;

const promptConfig = {
  name: 'caseMemorySummarizationPrompt',
  input: { schema: CaseMemoryInputSchema },
  output: { schema: CaseMemoryOutputSchema },
  prompt: `Você está condensando um atendimento encerrado para memória operacional de um bot de suporte.

Objetivo:
- Criar uma memória curta, reutilizável e sem ruído.
- Preservar problema, procedimento e resultado.
- Remover cumprimentos, frases vazias e dados pessoais desnecessários.

Regras:
- Só use informações realmente presentes no histórico.
- Se o caso não tiver resolução clara, não invente. Nesse caso, marque shouldStore=false.
- Prefira linguagem operacional e objetiva.
- "problem" deve descrever a dor do cliente.
- "resolution" deve descrever a ação, passo a passo ou decisão tomada.
- "outcome" deve dizer o resultado final.
- "keywords" devem ajudar busca semântica e operacional.

Contexto:
- Workspace: {{workspaceId}}
- Canal: {{channel}}
- Contato: {{contactName}}
- Motivo de encerramento: {{closeReasonLabel}}
- Observações de encerramento: {{closeNotes}}

Histórico do atendimento:
{{{chatHistory}}}`,
};

const defaultPrompt = ai.definePrompt(promptConfig);

export async function summarizeCaseMemory(input: CaseMemoryInput): Promise<CaseMemoryOutput> {
  const model = input.model || DEFAULT_AUTOPILOT_MODEL;
  const apiKey =
    input.apiKey?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENAI_API_KEY?.trim() ||
    '';

  if (!isLmStudioModel(model) && (!apiKey || apiKey === 'no-key-configured')) {
    throw new Error('No Gemini API key configured for case memory summarization.');
  }

  let prompt = defaultPrompt;
  const defaultEnvKey = process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';

  if (isLmStudioModel(model)) {
    return requestLmStudioJson({
      model,
      schema: CaseMemoryOutputSchema,
      schemaName: 'dialogy_case_memory',
      jsonSchema: {
        type: 'object',
        properties: {
          shouldStore: { type: 'boolean' },
          summary: { type: 'string' },
          problem: { type: 'string' },
          resolution: { type: 'string' },
          outcome: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        },
        required: ['shouldStore', 'summary', 'problem', 'resolution', 'outcome', 'keywords'],
        additionalProperties: false,
      },
      systemPrompt: [
        'Condense um atendimento encerrado para memoria operacional reutilizavel.',
        'Use somente fatos presentes no historico. Remova dados pessoais desnecessarios.',
        'Se nao houver resolucao clara, use shouldStore=false. Responda somente JSON.',
      ].join(' '),
      userPrompt: [
        `Canal: ${input.channel || ''}`,
        `Motivo de encerramento: ${input.closeReasonLabel || ''}`,
        `Observacoes: ${input.closeNotes || ''}`,
        `Historico:\n${input.chatHistory}`,
      ].join('\n'),
      timeoutMs: Number.parseInt(process.env.AI_CASE_MEMORY_TIMEOUT_MS || '', 10) || 10000,
      maxTokens: 500,
    });
  } else if (defaultEnvKey !== apiKey) {
    const { genkit } = require('genkit');
    const { googleAI } = require('@genkit-ai/google-genai');

    const dynamicAi = genkit({
      plugins: [googleAI({ apiKey })],
      model,
    });

    prompt = dynamicAi.definePrompt(promptConfig);
  }

  const result = await prompt(input, { model });
  const output = result.output;
  if (!output) {
    throw new Error('Case memory summarization returned no structured output.');
  }

  if (result.usage && input.autopilotConfigId) {
    await logAutopilotUsage({
      configId: input.autopilotConfigId,
      flowName: 'caseMemorySummarization',
      modelName: model,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    });
  }

  return CaseMemoryOutputSchema.parse(output);
}
