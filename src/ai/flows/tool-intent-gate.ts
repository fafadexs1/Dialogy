import { requestDecisionJson } from '@/services/ai/platform-json';
import { z } from 'zod';

const ToolIntentGateInputSchema = z.object({
  customerMessage: z.string(),
  chatHistory: z.string().optional(),
  toolName: z.enum(['transfer_chat', 'close_chat']),
  targetTeamName: z.string().optional().default(''),
  candidateReason: z.string(),
  escalationPolicy: z.string().optional(),
  closingPolicy: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  workspaceId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const ToolIntentGateOutputSchema = z.object({
  execute: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  reason: z.string().default(''),
});

export type ToolIntentGateInput = z.input<typeof ToolIntentGateInputSchema>;
export type ToolIntentGateOutput = z.infer<typeof ToolIntentGateOutputSchema>;

export async function classifyToolIntent(input: ToolIntentGateInput): Promise<ToolIntentGateOutput> {
  const parsedInput = ToolIntentGateInputSchema.parse(input);
  const toolSpecificRules = parsedInput.toolName === 'close_chat'
    ? [
        'Regra para close_chat:',
        '- execute=false: cliente negou encerramento, por exemplo "nao encerra", "nao fecha o atendimento", "nao finaliza".',
        '- execute=false: "fechar" se refere a concluir um negocio, pedido, recurso ou decisao, e nao a terminar a conversa atual.',
        '- execute=true, confidence=high: cliente pediu claramente para encerrar, finalizar, fechar, desligar ou parar a CONVERSA/CHAT/ATENDIMENTO atual.',
        '- execute=true, confidence=medium: mensagem curta e contextual indica que o cliente quer terminar o atendimento atual, mesmo com linguagem informal ou gíria.',
        '- execute=false: cliente quer cancelar ou encerrar algo administrado pelo negocio. Isso e uma solicitacao operacional, nao fechamento do chat.',
        '- execute=false: cliente só agradeceu, disse ok, ou respondeu algo ambíguo sem pedir para terminar o atendimento.',
        '- Na duvida entre medium e false, prefira false.',
      ]
    : [
        'Regra para transfer_chat:',
        '- execute=true, confidence=high: cliente pediu EXPLICITAMENTE falar com humano, atendente, consultor, setor ou equipe.',
        '- execute=true, confidence=medium: a politica de escalonamento cobre claramente o caso e o agente nao possui um proximo passo permitido capaz de avancar a solicitacao.',
        '- execute=true, confidence=medium: cliente esta frustrado/irritado e o contexto indica que precisa de atendimento humano.',
        '- execute=false: cliente esta fazendo uma pergunta, avaliando opcoes, pedindo informacao ou mencionando um assunto que o agente ainda consegue conduzir.',
        '- execute=false: existe uma proxima pergunta, consulta ou acao segura que o agente pode realizar para avancar o objetivo.',
        '- Na duvida entre medium e false, prefira false.',
      ];

  const prompt = [
    'Voce e um classificador de intencao de ferramenta para atendimento.',
    'Decida se a ferramenta candidata deve ser executada agora.',
    'Responda somente JSON: {"execute": boolean, "confidence": "low|medium|high", "reason": "curto"}.',
    '',
    ...toolSpecificRules,
    parsedInput.escalationPolicy ? `\nPolitica de escalonamento do agente:\n${parsedInput.escalationPolicy.slice(0, 400)}` : '',
    parsedInput.closingPolicy ? `\nPolitica de encerramento do agente:\n${parsedInput.closingPolicy.slice(0, 400)}` : '',
    '',
    `Ferramenta: ${parsedInput.toolName}`,
    parsedInput.targetTeamName ? `Equipe alvo: ${parsedInput.targetTeamName}` : '',
    `Motivo candidato: ${parsedInput.candidateReason}`,
    parsedInput.chatHistory ? `Historico recente:\n${parsedInput.chatHistory.slice(-1200)}` : '',
    `Mensagem do cliente:\n${parsedInput.customerMessage}`,
  ].filter(Boolean).join('\n');

  try {
    return await requestDecisionJson('toolIntentGate', {
        workspaceId: input.workspaceId,
        schema: ToolIntentGateOutputSchema,
        schemaName: 'dialogy_tool_intent_gate',
        jsonSchema: {
          type: 'object',
          properties: {
            execute: { type: 'boolean' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            reason: { type: 'string' },
          },
          required: ['execute', 'confidence', 'reason'],
          additionalProperties: false,
        },
        systemPrompt: 'Decida se a ferramenta candidata deve ser executada e responda somente o JSON solicitado.',
        userPrompt: prompt,
        maxTokens: 80,
    });
  } catch (error) {
    console.warn('[AI_DECISION] toolIntentGate failed; preserving deterministic behavior:', error);
    return { execute: false, confidence: 'low', reason: 'provider_gate_failed' };
  }
}
