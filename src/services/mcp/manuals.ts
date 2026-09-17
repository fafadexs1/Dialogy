import 'server-only';

import type { ManualCatalogResponse, McpServerConfig, ToolManualInfo } from './types';
import { callMcpServerTool } from './client';

/**
 * Resolve the base URL for manuals from an MCP server URL.
 * e.g., http://localhost:8090/mcp -> http://localhost:8090/manuals
 */
export function resolveManualsBaseUrl(serverUrl?: string): string | null {
  if (!serverUrl) return null;
  try {
    const url = new URL(serverUrl);
    // If pathname ends with /mcp or /sse, strip it to the origin or base path
    let basePath = url.pathname.replace(/\/mcp\/?$/i, '').replace(/\/sse\/?$/i, '');
    if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
    url.pathname = `${basePath}/manuals`;
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Fetch the official technical manuals catalog from an ACS MCP server.
 * Tries direct HTTP endpoint first (/manuals), then falls back to `get_tool_manual` tool call.
 */
export async function fetchMcpServerManuals(server: McpServerConfig): Promise<ManualCatalogResponse | null> {
  const manualsUrl = resolveManualsBaseUrl(server.url);

  // 1. Try HTTP GET /manuals
  if (manualsUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(server.headers || {}),
      };

      const res = await fetch(manualsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.tools) && data.tools.length > 0) {
          return {
            version: String(data.version || '2.0.0'),
            totalTools: Number(data.totalTools || data.tools.length),
            categories: Array.isArray(data.categories) ? data.categories : [],
            tools: data.tools.map((t: any) => ({
              name: String(t.name || ''),
              title: String(t.title || t.name || ''),
              category: String(t.category || 'Geral'),
              summary: String(t.summary || ''),
              fileName: String(t.file_name || t.fileName || `${t.name}.md`),
            })),
          };
        }
      }
    } catch {
      // Fallback to tool call below
    }
  }

  // 2. Try calling `get_tool_manual` via MCP tool
  try {
    const toolResult = await callMcpServerTool({
      server,
      toolName: 'get_tool_manual',
      arguments: {},
      totalTimeoutMs: 6000,
    });

    const structured = (toolResult as any)?.structuredContent;
    if (structured && Array.isArray(structured.tools) && structured.tools.length > 0) {
      return {
        version: String(structured.version || '2.0.0'),
        totalTools: Number(structured.totalTools || structured.tools.length),
        categories: Array.isArray(structured.categories) ? structured.categories : [],
        tools: structured.tools.map((t: any) => ({
          name: String(t.name || ''),
          title: String(t.title || t.name || ''),
          category: String(t.category || 'Geral'),
          summary: String(t.summary || ''),
          fileName: String(t.file_name || t.fileName || `${t.name}.md`),
        })),
      };
    }
  } catch {
    // Both attempts failed
  }

  return null;
}

/**
 * Fetch the complete raw Markdown manual for a specific tool or the general index.
 * Tries HTTP GET /manuals/:toolName?format=raw, then falls back to `get_tool_manual`.
 */
export async function fetchToolManualMarkdown(
  server: McpServerConfig,
  toolName: string
): Promise<{ title: string; markdown: string; category?: string } | null> {
  const cleanName = toolName.trim().toLowerCase();
  const manualsUrl = resolveManualsBaseUrl(server.url);

  // 1. Try HTTP GET /manuals/:tool_name?format=raw
  if (manualsUrl) {
    try {
      const targetUrl = `${manualsUrl}/${encodeURIComponent(cleanName || 'index')}?format=raw`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const headers: Record<string, string> = {
        Accept: 'text/markdown, text/plain, */*',
        ...(server.headers || {}),
      };

      const res = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          return {
            title: cleanName === 'index' || !cleanName ? 'Visão Geral & Catálogo' : cleanName,
            markdown: text,
          };
        }
      }
    } catch {
      // Fallback to tool call below
    }
  }

  // 2. Fallback: call `get_tool_manual` via MCP tool
  try {
    const toolResult = await callMcpServerTool({
      server,
      toolName: 'get_tool_manual',
      arguments: cleanName && cleanName !== 'index' ? { tool_name: cleanName } : {},
      totalTimeoutMs: 6000,
    });

    const content = (toolResult as any)?.content;
    const text = Array.isArray(content)
      ? content.map((c: any) => (c.type === 'text' ? c.text : '')).join('\n').trim()
      : '';

    if (text) {
      const structured = (toolResult as any)?.structuredContent;
      return {
        title: structured?.title || (cleanName === 'index' || !cleanName ? 'Visão Geral & Catálogo' : cleanName),
        category: structured?.category,
        markdown: text,
      };
    }
  } catch {
    // Failed
  }

  return null;
}
