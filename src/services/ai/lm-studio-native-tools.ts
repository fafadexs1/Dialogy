import type { AgentToolAction, AgentToolName } from '@/services/agent-tools/types';
import { getAgentToolDefinition } from '@/services/agent-tools/catalog';
import {
  getLmStudioModelId,
  normalizeLmStudioConfig,
  type LmStudioConfig,
} from '@/services/ai/lm-studio';

/**
 * Determines if a tool from the catalog is eligible for native LM Studio
 * function calling. Only side-effect-free tools are offered. Write/action
 * tools are handled through the JSON-schema actions path instead.
 */
function isNativeToolEligible(name: string): boolean {
  if (name.startsWith('mcp')) return false;

  const definition = getAgentToolDefinition(name as AgentToolName);
  if (!definition) return false;
  if (definition.sideEffect !== 'none') return false;
  if (definition.requiresHumanApproval) return false;

  return true;
}

function buildToolParameters(inputSchema?: Record<string, unknown> | null) {
  if (inputSchema && typeof inputSchema === 'object' && Object.keys(inputSchema.properties || {}).length > 0) {
    return { ...inputSchema, additionalProperties: false };
  }
  return { type: 'object', properties: {}, additionalProperties: false };
}

export function buildLmStudioNativeTools(enabledToolNames: string[]) {
  return enabledToolNames
    .filter(isNativeToolEligible)
    .map((name) => {
      const definition = getAgentToolDefinition(name as AgentToolName);
      if (!definition) return null;

      return {
        type: 'function' as const,
        function: {
          name: definition.name,
          description: definition.description,
          parameters: buildToolParameters(definition.inputSchema),
        },
      };
    })
    .filter((tool): tool is NonNullable<typeof tool> => tool !== null);
}

function sanitizeNativeToolPayload(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const definition = getAgentToolDefinition(name as AgentToolName);
  const properties = definition?.inputSchema
    && typeof definition.inputSchema === 'object'
    && definition.inputSchema.properties
    && typeof definition.inputSchema.properties === 'object'
      ? definition.inputSchema.properties as Record<string, unknown>
      : {};
  const payload = Object.fromEntries(
    Object.entries(args)
      .filter(([key]) => Object.prototype.hasOwnProperty.call(properties, key)),
  );
  if (
    name === 'sgp_fetch_contact_panel_data'
    && payload.contractId != null
    && !/^\d+$/.test(String(payload.contractId))
  ) {
    delete payload.contractId;
  }
  return payload;
}

export function convertLmStudioNativeToolCalls(toolCalls: unknown): AgentToolAction[] {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls.flatMap((toolCall: { function?: { name?: unknown; arguments?: unknown } }) => {
    const name = toolCall?.function?.name;
    if (typeof name !== 'string' || !isNativeToolEligible(name)) return [];

    let payload: Record<string, unknown> = {};
    try {
      const args = typeof toolCall.function?.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments;
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        payload = sanitizeNativeToolPayload(name, args as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed model-provided arguments.
    }

    return [{
      type: name,
      reason: `LM Studio native tool call: ${name}`,
      payload,
    } as AgentToolAction];
  });
}

export function shouldRequestLmStudioNativeTools(_input: {
  customerMessage: string;
  response?: string | null;
}): boolean {
  // Let the model decide via tool_choice: 'auto'. Policy and schema checks still
  // run after the model returns a tool call.
  return true;
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
              'Decida se alguma ferramenta e necessaria para atender a solicitacao do cliente.',
              'Nunca invente CPF, CNPJ, contrato, fatura ou qualquer identificador.',
              'Se faltar identificador obrigatorio, nao chame ferramenta; responda solicitando o dado ausente.',
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
