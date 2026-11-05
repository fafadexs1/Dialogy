# Phase 1: Data Model & Contracts

**Feature**: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar
**Date**: 2026-09-14
**Spec**: [spec.md](./spec.md)

---

## 1. Modelos de Dados Principais

### McpServerConfig (Extensão)
Representa a configuração persistida de um servidor MCP no `workspace_integrations`.

```typescript
export type McpServerTransport = 'streamable_http' | 'sse' | 'stdio' | 'direct_http';

export interface McpServerConfig {
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
  healthStatus: 'healthy' | 'unreachable' | 'unknown';
  healthCheckedAt?: string | null;
  healthLatencyMs?: number | null;
  tools: McpToolConfig[];
  // Novos metadados para /como-usar e manuais oficiais
  manuals?: {
    version: string;
    totalTools: number;
    categories: string[];
    syncedAt: string;
  } | null;
}
```

### McpToolConfig (Enriquecido)
Configuração de cada ferramenta sincronizada do MCP:

```typescript
export interface McpToolConfig {
  qualifiedName: string; // Ex: mcp:acs-router:get_router_details
  serverId: string;
  serverName: string;
  name: string;          // Ex: get_router_details
  title: string | null;  // Ex: Diagnóstico Óptico e Status Físico
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  } | null;
  // Enriquecimento com regras do manual /como-usar
  manualSummary?: string | null;
  operationalRules?: string[] | null;
}
```

### ToolManualInfo & ManualCatalog
Representa os manuais do endpoint `/manuals` do ACS:

```typescript
export interface ToolManualInfo {
  name: string;        // Ex: configure_wifi
  title: string;       // Ex: Configuração Atômica de Wi-Fi
  category: string;    // Ex: Operações Wi-Fi
  summary: string;     // Ex: Altera atômica e simultaneamente SSID, senha, canal...
  fileName: string;    // Ex: configure_wifi.md
  markdown?: string;
}

export interface ManualCatalogResponse {
  version: string;
  totalTools: number;
  categories: string[];
  tools: ToolManualInfo[];
}
```

### StructuredMcpError
Estrutura de erro acionável retornada pelo ACS MCP:

```typescript
export interface StructuredMcpError {
  error_code: string;
  message: string;
  remedial_suggestion?: string;
  requested_tool?: string;
  available_tools?: ToolManualInfo[];
}
```
