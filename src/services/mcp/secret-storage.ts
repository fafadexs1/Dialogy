import 'server-only';

import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import type { McpServerConfig } from './types';

const key = () => process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY || process.env.META_PAYLOAD_ENCRYPTION_KEY;
const keyName = 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY';

/** Legacy plaintext remains readable. New saves seal headers/environment, scoped to server and workspace. */
export function sealMcpServerSecrets(workspaceId: string, server: McpServerConfig) {
  const { headers, env, ...publicConfig } = server;
  if (!Object.keys(headers || {}).length && !Object.keys(env || {}).length) return { ...publicConfig, headers: {}, env: {} };
  return { ...publicConfig, headers: {}, env: {}, encryptedSecrets: encryptWithKey(JSON.stringify({ workspaceId, serverId: server.id, headers, env }), key(), keyName) };
}

export function openMcpServerSecrets(workspaceId: string, server: Record<string, unknown>) {
  if (!server.encryptedSecrets) return { headers: server.headers || {}, env: server.env || {} };
  const payload = JSON.parse(decryptWithKey(String(server.encryptedSecrets), key(), keyName));
  if (payload.workspaceId !== workspaceId || payload.serverId !== server.id) throw new Error('Credencial MCP fora do escopo deste servidor.');
  return { headers: payload.headers || {}, env: payload.env || {} };
}
