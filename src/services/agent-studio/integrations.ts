import 'server-only';

import { validateSchema } from 'genkit/schema';
import { listNexusCredentialSummaries, loadNexusCredentialPayload } from '@/modules/nexus/services/credentials';
import { resolveNexusOAuthToken } from '@/modules/nexus/services/oauth-credentials';
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';
import { callMcpServerTool, parseQualifiedMcpToolName } from '@/services/mcp/client';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import { buildStudioHttpRequest, buildStudioMcpArguments, mapStudioOutputs, type StudioDataContext } from './data-mapping';
import { HttpRequestStepConfigSchema, McpToolStepConfigSchema, type HttpRequestStepConfig, type McpToolStepConfig } from './types';

import { studioConnectionFingerprint, studioMcpFingerprint } from './integration-identity';
export { studioMcpFingerprint as mcpContractFingerprint } from './integration-identity';

export function redactStudioIntegrationResult(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 20) return '[conteúdo omitido]';
  if (typeof value === 'string') {
    let sanitized = value;
    for (const secret of secrets.filter(Boolean)) sanitized = sanitized.split(secret).join('[protegido]');
    return sanitized;
  }
  if (Array.isArray(value)) return value.map((item) => redactStudioIntegrationResult(item, secrets, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const isWifiRadio = 'ssid' in obj || 'band' in obj || 'radios' in obj;

  return Object.fromEntries(Object.entries(obj).map(([key, child]) => {
    const isWifiPassword = (isWifiRadio || /wifi|wlan/i.test(key)) && /password|passphrase|key/i.test(key);
    const shouldRedact = !isWifiPassword && /password|secret|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie/i.test(key);
    return [key, shouldRedact ? '[protegido]' : redactStudioIntegrationResult(child, secrets, depth + 1)];
  }));
}

/** Same network executor as Nexus: DNS-pinned HTTPS, response limits, no redirects. */
export async function executeStudioHttp(input: {
  workspaceId: string;
  config: HttpRequestStepConfig;
  context: StudioDataContext;
  confirmed: boolean;
  signal?: AbortSignal;
  expectedConnectionFingerprint?: string;
}) {
  const config = HttpRequestStepConfigSchema.parse(input.config);
  if ((config.method !== 'GET' || config.requiresConfirmation) && !input.confirmed) {
    throw new Error('Confirme a operação antes de executar esta chamada de API.');
  }
  let baseUrl: string | undefined;
  const authHeaders: Record<string, string> = {};
  const secrets: string[] = [];
  let oauthCredentialId: string | undefined;
  if (config.connectionId) {
    const connections = await listNexusCredentialSummaries(input.workspaceId);
    const connection = connections.find((item) => item.id === config.connectionId && item.metadata.kind === 'agent_http');
    if (!connection) throw new Error('Conexão de API não encontrada neste workspace.');
    const notionSearch = connection.metadata.provider === 'notion' && config.method === 'POST' && config.url === '/v1/search';
    const calendarFreebusy = connection.metadata.provider === 'google_workspace' && connection.metadata.app === 'calendar' && config.method === 'POST' && config.url === '/calendar/v3/freeBusy';
    if (['google_workspace', 'github', 'notion'].includes(String(connection.metadata.provider)) && connection.metadata.access === 'read' && config.method !== 'GET' && !notionSearch && !calendarFreebusy) throw new Error('Esta conexão permite apenas leitura.');
    if (input.expectedConnectionFingerprint && input.expectedConnectionFingerprint !== studioConnectionFingerprint(connection)) throw new Error('A identidade ou o endereço da conexão mudou. Revise e publique o agente novamente antes de executar.');
    baseUrl = String(connection.metadata.baseUrl || '');
    if (!baseUrl) throw new Error('A conexão está sem endereço base.');
    if (connection.metadata.allowedOrigin && connection.metadata.allowedOrigin !== new URL(baseUrl).origin) throw new Error('Esta credencial não autoriza a origem configurada.');
    if (connection.metadata.authType === 'oauth2') {
      if (connection.type !== 'oauth2') throw new Error('Credencial OAuth2 incompatível com a conexão.');
      oauthCredentialId = connection.id;
      // Reserve the authorization header before acquiring any credentials.
      authHeaders.Authorization = '';
    } else if (connection.metadata.authType !== 'none') {
      const credential = await loadNexusCredentialPayload({
        workspaceId: input.workspaceId, credentialId: connection.id, allowedTypes: ['api_key', 'bearer', 'basic'],
      });
      const secret = credential.payload;
      if (credential.type === 'bearer') {
        const token = String(secret.token ?? secret.bearerToken ?? '');
        if (!token) throw new Error('A conexão está sem token.');
        secrets.push(token);
        authHeaders.Authorization = `Bearer ${token}`;
      } else if (credential.type === 'basic') {
        const username = String(secret.username ?? secret.basicUsername ?? '');
        const password = String(secret.password ?? secret.basicPassword ?? '');
        if (!username || !password) throw new Error('A conexão está sem usuário ou senha.');
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        secrets.push(password, encoded);
        authHeaders.Authorization = `Basic ${encoded}`;
      } else {
        const name = String(secret.name ?? secret.apiKeyHeader ?? 'X-API-Key');
        const value = String(secret.value ?? secret.apiKeyValue ?? '');
        if (!value) throw new Error('A conexão está sem chave de API.');
        if (/^(host|connection|content-length|transfer-encoding|cookie)$/i.test(name)) throw new Error('Cabeçalho de autenticação inválido.');
        authHeaders[name] = value;
        secrets.push(value);
      }
    }
  } else if (config.authType !== 'none') {
    throw new Error('Selecione uma conexão segura para autenticar a API.');
  }
  const request = buildStudioHttpRequest(config, input.context, baseUrl);
  const authNames = new Set(Object.keys(authHeaders).map((name) => name.toLowerCase()));
  if (Object.keys(request.headers).some((name) => authNames.has(name.toLowerCase()))) {
    throw new Error('A etapa não pode substituir a autenticação da conexão.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Teste cancelado.'));
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error('A chamada de API excedeu o tempo limite.'), { code: 'TIMEOUT' });
        controller.abort(error);
        reject(error);
      }, config.timeoutSeconds * 1000);
    });
    const dispatch = () => executeNexusHttpOperation({
      workspaceId: input.workspaceId,
      // Exact object bindings prevent customer text from being re-evaluated as templates.
      config: {
        url: request.url, method: config.method, headers: '{{studio.headers}}', query: '{{studio.query}}',
        body: '{{studio.body}}', bodyType: config.method === 'GET' ? 'none' : 'json',
        timeoutMs: config.timeoutSeconds * 1000, maxResponseBytes: 1_000_000, maxRequestBytes: 1_000_000,
      },
      runtimeSource: { studio: { ...request, headers: { ...request.headers, ...authHeaders } } },
      signal: controller.signal,
    });
    const executeWithSafeRetries = async () => {
      if (oauthCredentialId) {
        const token = await resolveNexusOAuthToken(input.workspaceId, oauthCredentialId, new URL(request.url).origin, controller.signal);
        secrets.push(token);
        authHeaders.Authorization = `Bearer ${token}`;
      }
      const retries = config.method === 'GET' && !config.requiresConfirmation ? config.maxRetries : 0;
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        try { return await dispatch(); }
        catch (error) {
          const retryable = error instanceof Error && 'retryable' in error && error.retryable === true;
          if (!retryable || attempt >= retries || controller.signal.aborted) throw error;
          // One deadline covers all attempts. Never retry writes, confirmation-gated calls, or malformed responses.
          await new Promise<void>((resolve, reject) => {
            const cancel = () => { clearTimeout(delay); reject(controller.signal.reason); };
            const delay = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, 250 * (attempt + 1));
            controller.signal.addEventListener('abort', cancel, { once: true });
          });
        }
      }
    };
    const result = await Promise.race([executeWithSafeRetries(), deadline]);
    const response = redactStudioIntegrationResult(result.data, secrets);
    return { statusCode: Number(result.status), response, values: mapStudioOutputs(response, config.outputMappings) };
  } catch (error) {
    const source = error as { status?: unknown; code?: unknown; details?: { status?: unknown } } | null;
    const status = Number(source?.status ?? source?.details?.status);
    const code = typeof source?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(source.code) ? source.code : undefined;
    throw Object.assign(new Error(String(redactStudioIntegrationResult(error instanceof Error ? error.message : 'Falha na chamada de API.', secrets))), {
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), ...(code ? { code } : {}),
    });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}

export async function resolveStudioMcpTool(workspaceId: string, config: McpToolStepConfig, allowStdio = false) {
  const parsed = parseQualifiedMcpToolName(config.qualifiedToolName);
  if (!parsed || parsed.serverId !== config.serverId) throw new Error('Ferramenta incompatível com o servidor selecionado.');
  const workspace = await getMcpWorkspaceConfig(workspaceId);
  const server = workspace.servers.find((item) => item.id === config.serverId && item.isActive);
  if (!server) throw new Error('Servidor MCP não encontrado ou inativo.');
  if (server.transport === 'stdio' && (!allowStdio || process.env.ALLOW_MCP_STDIO !== 'true')) {
    throw new Error('Este servidor local exige autorização administrativa para execução.');
  }
  const tool = server.tools?.find((item) => item.qualifiedName === config.qualifiedToolName && item.serverId === server.id);
  if (!tool) throw new Error('A ferramenta não está disponível. Sincronize o servidor e revise a etapa.');
  return { server, tool, safety: classifyMcpToolSafety(tool.qualifiedName, tool), fingerprint: studioMcpFingerprint(tool, server) };
}

export async function executeStudioMcp(input: {
  workspaceId: string;
  config: McpToolStepConfig;
  context: StudioDataContext;
  confirmed: boolean;
  allowStdio?: boolean;
  expectedFingerprint?: string;
  signal?: AbortSignal;
}) {
  const config = McpToolStepConfigSchema.parse(input.config);
  const { server, tool, safety, fingerprint } = await resolveStudioMcpTool(input.workspaceId, config, input.allowStdio);
  if (input.expectedFingerprint && input.expectedFingerprint !== fingerprint) {
    throw new Error('A ferramenta mudou desde a publicação. Revise o procedimento antes de executar.');
  }
  if ((safety.sideEffect !== 'none' || config.requiresConfirmation) && !input.confirmed) {
    throw new Error('Esta ferramenta requer confirmação antes de executar.');
  }
  const args = buildStudioMcpArguments(config, input.context);
  if (tool.inputSchema && !validateSchema(args, { jsonSchema: tool.inputSchema }).valid) {
    throw new Error('Os dados de entrada não atendem aos campos e tipos exigidos pela ferramenta.');
  }
  let result: Awaited<ReturnType<typeof callMcpServerTool>>;
  try { result = await callMcpServerTool({ server, toolName: tool.name, arguments: args, totalTimeoutMs: 30_000, strictPublicNetwork: true, signal: input.signal }); }
  catch (error) {
    const source = error as { status?: unknown; code?: unknown } | null;
    const status = Number(source?.status);
    const code = typeof source?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(source.code) ? source.code : undefined;
    throw Object.assign(new Error(String(redactStudioIntegrationResult(error instanceof Error ? error.message : 'Falha no MCP.', Object.values(server.headers || {})))), {
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), ...(code ? { code } : {}),
    });
  }
  if (result.isError) throw new Error('A ferramenta informou falha. Nenhum resultado foi considerado concluído.');
  let data: unknown = result.structuredContent;
  if (data === undefined) {
    const text = Array.isArray(result.content)
      ? result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n') : '';
    try { data = JSON.parse(text); } catch { data = { text }; }
  }
  if (tool.outputSchema && !validateSchema(data, { jsonSchema: tool.outputSchema }).valid) {
    throw new Error('O resultado da ferramenta não corresponde ao contrato configurado.');
  }
  const response = redactStudioIntegrationResult(data, Object.values(server.headers || {}));
  return { response, values: mapStudioOutputs(response, config.outputMappings), fingerprint, riskLevel: safety.riskLevel };
}
