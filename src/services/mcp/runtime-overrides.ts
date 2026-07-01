import type { McpServerConfig } from './types';

export function applyMcpRuntimeEndpointOverride(
  server: McpServerConfig,
  environment: Record<string, string | undefined> = process.env,
): McpServerConfig {
  if (environment.MCP_ALLOW_ENDPOINT_OVERRIDES !== 'true') return server;
  const raw = environment.MCP_HTTP_ENDPOINT_OVERRIDES?.trim();
  if (!raw || server.transport === 'stdio') return server;

  let overrides: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return server;
    overrides = parsed as Record<string, unknown>;
  } catch {
    return server;
  }

  const candidate = overrides[server.id];
  if (typeof candidate !== 'string' || !candidate.trim()) return server;
  try {
    const url = new URL(candidate.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return server;
    if (url.username || url.password) return server;
    return {
      ...server,
      url: url.toString(),
    };
  } catch {
    return server;
  }
}
