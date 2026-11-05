export type McpServerTransport = 'streamable_http' | 'sse' | 'stdio' | 'direct_http';

export type ToolManualInfo = {
  name: string;
  title: string;
  category: string;
  summary: string;
  fileName: string;
  markdown?: string;
  markdownLength?: number;
};

export type ManualCatalogResponse = {
  version: string;
  totalTools: number;
  categories: string[];
  tools: ToolManualInfo[];
};

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
  healthStatus?: 'healthy' | 'unreachable' | 'unknown';
  healthCheckedAt?: string | null;
  healthLatencyMs?: number | null;
  tools?: McpToolConfig[];
  manualsCatalog?: ManualCatalogResponse | null;
  manualsSyncedAt?: string | null;
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
  manualSummary?: string | null;
  operationalRules?: string[] | null;
};

export type McpWorkspaceConfig = {
  servers: McpServerConfig[];
};
