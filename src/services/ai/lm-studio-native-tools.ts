import type { AgentToolAction } from '@/services/agent-tools/types';
import {
  getLmStudioModelId,
  normalizeLmStudioConfig,
  type LmStudioConfig,
} from '@/services/ai/lm-studio';

const NATIVE_READ_ONLY_TOOL_NAMES = [
  'sgp_fetch_contracts',
  'sgp_fetch_contact_panel_data',
] as const;

type NativeReadOnlyToolName = typeof NATIVE_READ_ONLY_TOOL_NAMES[number];

type LmStudioNativeToolCall = {
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

const nativeReadOnlyToolDescriptions: Record<NativeReadOnlyToolName, string> = {
  sgp_fetch_contracts:
    'Consulta contratos do cliente no SGP. Use somente quando o cliente informou CPF/CNPJ ou quando ele ja estiver salvo no CRM. Nunca invente identificadores, contratos, dados ou resultados. Solicite apenas a execucao; a resposta final deve usar somente o retorno real da ferramenta.',
  sgp_fetch_contact_panel_data:
    'Consulta resumo, contratos, conexao e faturas do cliente no SGP. Use somente quando o cliente informou CPF/CNPJ ou quando ele ja estiver salvo no CRM. Informe contractId somente para restringir a consulta a um contrato especifico quando possuir um ID real retornado anteriormente pelo SGP ou informado claramente pelo cliente. Nunca invente identificadores, contratos, faturas, datas, valores, links, diagnosticos ou procedimentos. Solicite apenas a execucao; a resposta final deve usar somente o retorno real da ferramenta.',
};

function isNativeReadOnlyToolName(value: unknown): value is NativeReadOnlyToolName {
  return typeof value === 'string'
    && NATIVE_READ_ONLY_TOOL_NAMES.includes(value as NativeReadOnlyToolName);
}

export function buildLmStudioNativeTools(enabledToolNames: string[]) {
  const enabledToolSet = new Set(enabledToolNames);

  return NATIVE_READ_ONLY_TOOL_NAMES
    .filter((name) => enabledToolSet.has(name))
    .map((name) => ({
      type: 'function' as const,
      function: {
        name,
        description: nativeReadOnlyToolDescriptions[name],
        parameters: name === 'sgp_fetch_contact_panel_data'
          ? {
              type: 'object',
              properties: {
                contractId: {
                  type: 'string',
                  description: 'ID real do contrato SGP. Use apenas para restringir a consulta a um contrato especifico.',
                },
              },
              additionalProperties: false,
            }
          : {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
      },
    }));
}

export function convertLmStudioNativeToolCalls(toolCalls: unknown): AgentToolAction[] {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls.flatMap((toolCall: LmStudioNativeToolCall) => {
    const name = toolCall?.function?.name;
    if (!isNativeReadOnlyToolName(name)) return [];

    let payload = {};
    if (name === 'sgp_fetch_contact_panel_data') {
      try {
        const args = typeof toolCall.function?.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function?.arguments;
        if (args && typeof args.contractId === 'string' && /^\d+$/.test(args.contractId.trim())) {
          payload = { contractId: args.contractId.trim() };
        }
      } catch {
        // Ignore malformed model-provided arguments.
      }
    }

    // CPF/CNPJ always comes from validated runtime context. Only a numeric
    // contractId may pass through to narrow the support lookup.
    return [{
      type: name,
      reason: `LM Studio native tool call: ${name}`,
      payload,
    }];
  });
}

export function shouldRequestLmStudioNativeTools(input: {
  customerMessage: string;
  response?: string | null;
}): boolean {
  const text = `${input.customerMessage}\n${input.response || ''}`.toLowerCase();
  return /\b(fatura|boleto|pix|contrato|financeir|pagamento|sinal|conex[aã]o|internet|cadastro|dados|consult|verific|status)\b/i.test(text);
}

export async function requestLmStudioNativeToolActions(input: {
  config: LmStudioConfig;
  model: string;
  enabledToolNames: string[];
  customerMessage: string;
  chatHistory?: string;
  timeoutMs?: number;
}): Promise<AgentToolAction[]> {
  const tools = buildLmStudioNativeTools(input.enabledToolNames);
  if (tools.length === 0 || !shouldRequestLmStudioNativeTools(input)) return [];

  const { baseUrl, apiToken } = normalizeLmStudioConfig(input.config);
  if (!baseUrl) throw new Error('LM Studio endpoint is not configured in superadmin.');

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? (Number.parseInt(process.env.LM_STUDIO_NATIVE_TOOL_TIMEOUT_MS || '', 10) || 6000)
  );

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        model: getLmStudioModelId(input.model),
        messages: [
          {
            role: 'system',
            content: [
              'Decida somente se uma consulta externa de leitura e necessaria para atender o cliente.',
              'Nunca invente CPF, CNPJ, contrato ou fatura.',
              'Se faltar identificador, nao chame ferramenta; responda solicitando o dado ausente.',
              'Nao solicite alteracoes, transferencias ou encerramentos.',
              'Nunca antecipe resultado, link, protocolo, prazo, diagnostico ou procedimento que dependa da ferramenta.',
            ].join(' '),
          },
          ...(input.chatHistory?.trim()
            ? [{ role: 'user', content: `Historico recente:\n${input.chatHistory.slice(-4000)}` }]
            : []),
          { role: 'user', content: input.customerMessage },
        ],
        tools,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 220,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`LM Studio native tools request failed (${response.status}): ${body}`);
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { tool_calls?: unknown } }>;
    };
    return convertLmStudioNativeToolCalls(body.choices?.[0]?.message?.tool_calls);
  } finally {
    clearTimeout(timeout);
  }
}
