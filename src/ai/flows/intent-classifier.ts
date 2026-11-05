import { requestDecisionJson } from '@/services/ai/platform-json';
import { z } from 'zod';
import type { KnowledgeBaseDocument } from '@/lib/types';
import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

const UNIVERSAL_INTENTS = [
  'greeting',
  'human_handoff',
  'purchase_inquiry',
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'availability_request',
  'billing_or_payment',
  'scheduling_request',
  'order_or_request_status',
  'support_request',
  'troubleshooting',
  'change_request',
  'return_or_refund',
  'cancellation_request',
  'document_request',
  'complaint',
  'thanks',
  'unknown',
] as const;

const AiIntentClassifierInputSchema = z.object({
  customerMessage: z.string(),
  chatHistory: z.string().optional(),
  deterministicIntent: z.enum(UNIVERSAL_INTENTS),
  deterministicConfidence: z.number().min(0).max(1),
  deterministicReason: z.string().optional(),
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
  workspaceId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const AiIntentClassifierOutputSchema = z.object({
  intent: z.enum(UNIVERSAL_INTENTS),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().default(''),
});

export type AiIntentClassifierInput = z.input<typeof AiIntentClassifierInputSchema>;
export type AiIntentClassifierOutput = z.infer<typeof AiIntentClassifierOutputSchema>;

function summarizeDocuments(documents: KnowledgeBaseDocument[] | undefined) {
  return (documents || [])
    .slice(0, 8)
    .map((doc) => {
      const name = String(doc.name || 'Documento');
      const category = String(doc.category || 'uncategorized');
      const content = String(doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 420);
      return `- ${name} [${category}]: ${content}`;
    })
    .join('\n')
    .slice(0, 2600);
}

export function shouldUseAiIntentClassifier(input: {
  intent: UniversalAutopilotIntent;
  confidence: number;
}) {
  if (input.intent === 'human_handoff' && input.confidence >= 0.9) return false;
  if (input.intent === 'greeting' && input.confidence >= 0.9) return false;
  if (input.intent === 'thanks' && input.confidence >= 0.9) return false;
  return input.intent === 'unknown' || input.confidence < 0.88;
}

export async function classifyAutopilotIntentWithAi(input: AiIntentClassifierInput): Promise<AiIntentClassifierOutput> {
  const parsedInput = AiIntentClassifierInputSchema.parse(input);
  const prompt = [
    'Voce e um classificador barato de intencao para um agente de atendimento.',
    'Classifique a NECESSIDADE do cliente. Nao escolha equipe e nao decida transferencia.',
    'Use o que o agente sabe: persona, documentos/notas, ferramentas habilitadas e campos do contato.',
    'Se o cliente relata problema, erro, lentidao, queda, acesso, equipamento, sinal ou conexao, prefira troubleshooting.',
    'Se o cliente quer pagar, boleto, fatura ou pix, use billing_or_payment.',
    'Se quer comprar/assinar/contratar, use purchase_inquiry.',
    'Se pede humano explicitamente, use human_handoff.',
    'Use cancellation_request somente para cancelar contrato, plano, assinatura, servico, pedido ou outro objeto de negocio.',
    'Pedido para encerrar/finalizar a conversa, chat ou atendimento atual nao e cancellation_request nem human_handoff; use thanks quando for uma despedida/conclusao e unknown nos demais casos. O gate de close_chat decide a ferramenta separadamente.',
    'Responda somente JSON: {"intent":"...","confidence":0.0,"reason":"curto"}.',
    `Intencoes validas: ${UNIVERSAL_INTENTS.join(', ')}`,
    '',
    `Classificacao deterministica: ${parsedInput.deterministicIntent} (${parsedInput.deterministicConfidence}) - ${parsedInput.deterministicReason || ''}`,
    parsedInput.agentName ? `Agente: ${parsedInput.agentName}` : '',
    parsedInput.agentKnowledgeBase ? `Persona/base do agente:\n${parsedInput.agentKnowledgeBase.replace(/\s+/g, ' ').trim().slice(0, 1400)}` : '',
    parsedInput.knowledgeDocuments?.length ? `Notas/documentos do agente:\n${summarizeDocuments(parsedInput.knowledgeDocuments as KnowledgeBaseDocument[])}` : '',
    parsedInput.enabledToolNames?.length ? `Ferramentas habilitadas: ${parsedInput.enabledToolNames.slice(0, 20).join(', ')}` : '',
    parsedInput.contactSignals ? `Sinais do contato: hasCustomerIdentifier=${Boolean(parsedInput.contactSignals.hasCustomerIdentifier)}; campos=${(parsedInput.contactSignals.customFieldLabels || []).slice(0, 12).join(', ')}` : '',
    parsedInput.chatHistory ? `Historico recente:\n${parsedInput.chatHistory.slice(-1400)}` : '',
    `Mensagem do cliente:\n${parsedInput.customerMessage}`,
  ].filter(Boolean).join('\n');

  try {
    return await requestDecisionJson('intentClassifier', {
        workspaceId: input.workspaceId,
        schema: AiIntentClassifierOutputSchema,
        schemaName: 'dialogy_intent_classifier',
        jsonSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: UNIVERSAL_INTENTS },
            confidence: { type: 'number' },
            reason: { type: 'string' },
          },
          required: ['intent', 'confidence', 'reason'],
          additionalProperties: false,
        },
        systemPrompt: 'Classifique a intencao de atendimento e responda somente o JSON solicitado.',
        userPrompt: prompt,
        maxTokens: 120,
    });
  } catch (error) {
    console.warn('[AI_DECISION] intentClassifier failed; preserving deterministic behavior:', error);
    return { intent: parsedInput.deterministicIntent, confidence: parsedInput.deterministicConfidence, reason: 'provider_classifier_failed' };
  }
}
