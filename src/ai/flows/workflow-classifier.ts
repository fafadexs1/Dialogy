import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import type { KnowledgeBaseDocument } from '@/lib/types';
import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

const WORKFLOW_TOOL_NAMES = [
  'sgp_fetch_contact_panel_data',
  'sgp_fetch_contracts',
] as const;

const AiWorkflowClassifierInputSchema = z.object({
  customerMessage: z.string(),
  chatHistory: z.string().optional(),
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  intentReason: z.string().optional(),
  deterministicExecutionMode: z.string().optional(),
  deterministicMissingSlots: z.array(z.string()).optional(),
  deterministicPlannedTools: z.array(z.string()).optional(),
  agentName: z.string().optional(),
  agentKnowledgeBase: z.string().optional(),
  knowledgeDocuments: z.array(z.object({
    name: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
  })).optional(),
  enabledToolNames: z.array(z.string()).optional(),
  contactSignals: z.object({
    hasCustomerIdentifier: z.boolean().optional(),
    customFieldLabels: z.array(z.string()).optional(),
  }).optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const AiWorkflowClassifierOutputSchema = z.object({
  shouldUseTools: z.boolean().default(false),
  needsCustomerIdentifier: z.boolean().default(false),
  suggestedTools: z.array(z.enum(WORKFLOW_TOOL_NAMES)).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().default(''),
});

export type AiWorkflowClassifierInput = z.input<typeof AiWorkflowClassifierInputSchema>;
export type AiWorkflowDecision = z.infer<typeof AiWorkflowClassifierOutputSchema>;

function cleanModelName(model: string | undefined): string {
  const configured = process.env.AI_WORKFLOW_CLASSIFIER_MODEL || model || DEFAULT_AUTOPILOT_MODEL;
  const geminiModel = configured.startsWith('googleai/') ? configured : DEFAULT_AUTOPILOT_MODEL;
  return geminiModel.replace(/^googleai\//, '');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('workflow classifier did not return JSON');
    return JSON.parse(match[0]);
  }
}

function summarizeDocuments(documents: KnowledgeBaseDocument[] | undefined) {
  return (documents || [])
    .slice(0, 8)
    .map((doc) => {
      const name = String(doc.name || 'Documento');
      const category = String(doc.category || 'uncategorized');
      const content = String(doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 360);
      return `- ${name} [${category}]: ${content}`;
    })
    .join('\n')
    .slice(0, 2400);
}

export function shouldUseAiWorkflowClassifier(input: {
  intent: UniversalAutopilotIntent;
  confidence: number;
  executionMode: string;
  plannedActions: string[];
  missingSlots: string[];
  enabledToolNames: string[];
  hasCustomerIdentifier: boolean;
}) {
  if (!input.enabledToolNames.includes('sgp_fetch_contact_panel_data')) return false;
  if (input.intent === 'human_handoff' || input.intent === 'greeting' || input.intent === 'thanks') return false;
  if (input.executionMode === 'pre_response_tools' && input.plannedActions.length > 0) return false;

  if (input.intent === 'unknown') return true;
  if (input.confidence < 0.88) return true;
  if (input.executionMode === 'continue_llm' && input.hasCustomerIdentifier) return true;
  if (input.executionMode === 'continue_llm' && input.missingSlots.length === 0) return true;
  return false;
}

export async function classifyAutopilotWorkflowWithAi(input: AiWorkflowClassifierInput): Promise<AiWorkflowDecision> {
  const parsedInput = AiWorkflowClassifierInputSchema.parse(input);
  const apiKey = parsedInput.apiKey?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return {
      shouldUseTools: false,
      needsCustomerIdentifier: false,
      suggestedTools: [],
      confidence: 0,
      reason: 'missing_api_key',
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: cleanModelName(parsedInput.model),
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 180,
      responseMimeType: 'application/json',
    },
  });

  const enabledWorkflowTools = (parsedInput.enabledToolNames || [])
    .filter((tool) => WORKFLOW_TOOL_NAMES.includes(tool as (typeof WORKFLOW_TOOL_NAMES)[number]));

  const prompt = [
    'Voce e um classificador barato de workflow para um agente de atendimento.',
    'Sua funcao e decidir se o agente deve consultar uma ferramenta read-only antes de responder ou pedir CPF/CNPJ.',
    'Nao decida transferencia humana, nao feche chat e nao sugira ferramentas de escrita ou risco.',
    'Use ferramentas somente quando a mensagem exigir dados operacionais atuais: contrato, cadastro, fatura, boleto, pix, status, conexao, sinal, LOS, roteador, wifi, fibra, protocolo ou documento do contrato.',
    'Se o cliente relata problema tecnico e ha identificador no contato, normalmente use sgp_fetch_contact_panel_data.',
    'Se o cliente relata problema tecnico e nao ha identificador, marque needsCustomerIdentifier=true.',
    'Se o cliente pede fatura/boleto/pix e ha identificador, use sgp_fetch_contact_panel_data.',
    'Se o cliente pede copia/status/dados de contrato e ha identificador, use sgp_fetch_contact_panel_data.',
    'Se for apenas venda, catalogo, disponibilidade generica, reclamacao sem necessidade operacional ou conversa comum, nao use ferramenta.',
    'Responda somente JSON: {"shouldUseTools":true,"needsCustomerIdentifier":false,"suggestedTools":["sgp_fetch_contact_panel_data"],"confidence":0.0,"reason":"curto"}.',
    '',
    `Intencao atual: ${parsedInput.intent} (${parsedInput.confidence}) - ${parsedInput.intentReason || ''}`,
    `Plano deterministico: mode=${parsedInput.deterministicExecutionMode || 'unknown'}; missingSlots=${(parsedInput.deterministicMissingSlots || []).join(',') || 'none'}; tools=${(parsedInput.deterministicPlannedTools || []).join(',') || 'none'}`,
    parsedInput.agentName ? `Agente: ${parsedInput.agentName}` : '',
    parsedInput.agentKnowledgeBase ? `Persona/base do agente:\n${parsedInput.agentKnowledgeBase.replace(/\s+/g, ' ').trim().slice(0, 1200)}` : '',
    parsedInput.knowledgeDocuments?.length ? `Notas/documentos do agente:\n${summarizeDocuments(parsedInput.knowledgeDocuments as KnowledgeBaseDocument[])}` : '',
    `Ferramentas read-only disponiveis para este classificador: ${enabledWorkflowTools.join(', ') || 'nenhuma'}`,
    parsedInput.contactSignals ? `Sinais do contato: hasCustomerIdentifier=${Boolean(parsedInput.contactSignals.hasCustomerIdentifier)}; campos=${(parsedInput.contactSignals.customFieldLabels || []).slice(0, 12).join(', ')}` : '',
    parsedInput.chatHistory ? `Historico recente:\n${parsedInput.chatHistory.slice(-1200)}` : '',
    `Mensagem do cliente:\n${parsedInput.customerMessage}`,
  ].filter(Boolean).join('\n');

  const timeoutMs = parsedInput.timeoutMs || 1800;
  const response = await Promise.race([
    model.generateContent(prompt),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`workflow classifier timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

  const parsedOutput = AiWorkflowClassifierOutputSchema.safeParse(extractJson(response.response.text()));
  if (!parsedOutput.success) {
    return {
      shouldUseTools: false,
      needsCustomerIdentifier: false,
      suggestedTools: [],
      confidence: 0,
      reason: 'invalid_classifier_response',
    };
  }

  return parsedOutput.data;
}
