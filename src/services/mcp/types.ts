export type McpServerTransport = 'streamable_http' | 'sse' | 'stdio';

export type McpServerConfig = {
  id: string;
  name: string;
  url?: string;
  transport: McpServerTransport;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  isActive: boolean;
  syncedAt?: string | null;
  lastError?: string | null;
  tools?: McpToolConfig[];
};

export type McpToolConfig = {
  qualifiedName: string;
  serverId: string;
  serverName: string;
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } | null;
};

export type McpWorkspaceConfig = {
  servers: McpServerConfig[];
};
