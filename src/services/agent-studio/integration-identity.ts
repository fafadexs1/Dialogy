import 'server-only';
import { createHash } from 'node:crypto';
import { stableStringify } from '@/services/workflow-runtime/utils';
import type { NexusCredentialSummary } from '@/modules/nexus/services/credentials';
import type { McpServerConfig, McpToolConfig } from '@/services/mcp/types';

export function studioConnectionFingerprint(connection: Pick<NexusCredentialSummary, 'id' | 'type' | 'metadata'>) {
  return createHash('sha256').update(stableStringify({ id: connection.id, type: connection.type, baseUrl: connection.metadata.baseUrl, authType: connection.metadata.authType, kind: connection.metadata.kind })).digest('hex');
}

export function studioMcpFingerprint(tool: McpToolConfig, server?: Pick<McpServerConfig, 'id' | 'url' | 'transport'>) {
  return createHash('sha256').update(stableStringify({ name: tool.qualifiedName, input: tool.inputSchema, output: tool.outputSchema, annotations: tool.annotations,
    server: server ? { id: server.id, url: server.url, transport: server.transport } : undefined })).digest('hex');
}
