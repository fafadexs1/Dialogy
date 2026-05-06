import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';

const ToolIntentGateInputSchema = z.object({
  customerMessage: z.string(),
  chatHistory: z.string().optional(),
  toolName: z.literal('transfer_chat'),
  targetTeamName: z.string(),
  candidateReason: z.string(),
  escalationPolicy: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const ToolIntentGateOutputSchema = z.object({
  execute: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  reason: z.string().default(''),
});

export type ToolIntentGateInput = z.infer<typeof ToolIntentGateInputSchema>;
export type ToolIntentGateOutput = z.infer<typeof ToolIntentGateOutputSchema>;

function cleanModelName(model: string | undefined): string {
  return (model || DEFAULT_AUTOPILOT_MODEL).replace(/^googleai\//, '');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('tool intent gate did not return JSON');
    return JSON.parse(match[0]);
  }
}

export async function classifyToolIntent(input: ToolIntentGateInput): Promise<ToolIntentGateOutput> {
  const parsedInput = ToolIntentGateInputSchema.parse(input);
  const apiKey = parsedInput.apiKey?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return { execute: false, confidence: 'low', reason: 'missing_api_key' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: cleanModelName(parsedInput.model),
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 80,
      responseMimeType: 'application/json',
    },
  });

  const prompt = [
    'Voce e um classificador de intencao de ferramenta para atendimento.',
    'Decida se a ferramenta candidata deve ser executada agora.',
    'Responda somente JSON: {"execute": boolean, "confidence": "low|medium|high", "reason": "curto"}.',
    '',
    'Regra para transfer_chat:',
    '- execute=true, confidence=high: cliente pediu EXPLICITAMENTE falar com humano, atendente, consultor, setor ou equipe.',
    '- execute=true, confidence=medium: cliente relata um PROBLEMA TECNICO claro (internet fora, lenta, sem sinal, roteador, etc.) que a equipe alvo pode resolver, E o agente virtual nao tem ferramentas para resolver sozinho.',
    '- execute=true, confidence=medium: cliente esta frustrado/irritado e o contexto indica que precisa de atendimento humano.',
    '- execute=false: cliente esta fazendo pergunta, comprando, consultando planos, pedindo informacao geral, ou mencionou um assunto sem precisar de atendimento humano.',
    '- execute=false: cliente esta fazendo transferencia de endereco, mudanca de plano, ou outra operacao que o agente consegue conduzir.',
    '- Na duvida entre medium e false, prefira false.',
    parsedInput.escalationPolicy ? `\nPolitica de escalonamento do agente:\n${parsedInput.escalationPolicy.slice(0, 400)}` : '',
    '',
    `Ferramenta: ${parsedInput.toolName}`,
    `Equipe alvo: ${parsedInput.targetTeamName}`,
    `Motivo candidato: ${parsedInput.candidateReason}`,
    parsedInput.chatHistory ? `Historico recente:\n${parsedInput.chatHistory.slice(-1200)}` : '',
    `Mensagem do cliente:\n${parsedInput.customerMessage}`,
  ].filter(Boolean).join('\n');

  const timeoutMs = parsedInput.timeoutMs || 2500;
  const response = await Promise.race([
    model.generateContent(prompt),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`tool intent gate timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

  const text = response.response.text();
  const parsedOutput = ToolIntentGateOutputSchema.safeParse(extractJson(text));

  if (!parsedOutput.success) {
    return { execute: false, confidence: 'low', reason: 'invalid_gate_response' };
  }

  return parsedOutput.data;
}
