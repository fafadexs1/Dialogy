import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { callMcpServerTool, listMcpServerTools } from '@/services/mcp/client';
import type { McpServerConfig } from '@/services/mcp/types';

describe('ACS Router MCP Direct Transport & Tool Discovery', () => {
  it('discovers tools and enriches with ACS /como-usar operational rules over direct JSON-RPC', async () => {
    // Create a mock MCP server mimicking ACS router-mcp
    const mockServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const json = JSON.parse(body);
        if (json.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'dialogy-router-mcp', version: '2.0.0' },
              capabilities: { tools: { listChanged: false } },
            },
          }));
          return;
        }

        if (json.method === 'notifications/initialized') {
          res.writeHead(202);
          res.end();
          return;
        }

        if (json.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: {
              tools: [
                {
                  name: 'list_routers',
                  description: 'Localiza CPEs por MAC, IP ou serial.',
                  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
                },
                {
                  name: 'configure_wifi',
                  description: 'Configuração atômica de Wi-Fi.',
                  inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, ssid: { type: 'string' } }, required: ['device_id'] },
                },
                {
                  name: 'reboot_router',
                  description: 'Reinício remoto auditado.',
                  inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['device_id', 'confirm'] },
                },
                {
                  name: 'get_tool_manual',
                  description: 'Manual técnico oficial (/como-usar).',
                  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' } } },
                },
              ],
            },
          }));
          return;
        }

        if (json.method === 'tools/call') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (json.params.name === 'get_tool_manual') {
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                content: [{ type: 'text', text: '# Manual Técnico: configure_wifi\n\nRegras de ouro...' }],
                structuredContent: { tool: 'configure_wifi', version: '2.1.0' },
              },
            }));
          } else {
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: { content: [{ type: 'text', text: 'ok' }] },
            }));
          }
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (mockServer.address() as any).port;

    const serverConfig: McpServerConfig = {
      id: 'mock-acs-server',
      name: 'ACS Mock',
      url: `http://127.0.0.1:${port}/mcp`,
      transport: 'direct_http',
      isActive: true,
    };

    try {
      const tools = await listMcpServerTools(serverConfig);
      expect(tools.length).toBe(4);

      // Verify ACS rules enrichment
      const configWifi = tools.find((t) => t.name === 'configure_wifi');
      expect(configWifi).toBeDefined();
      expect(configWifi?.manualSummary).toContain('Configuração atômica');
      expect(configWifi?.operationalRules?.length).toBeGreaterThan(0);

      const reboot = tools.find((t) => t.name === 'reboot_router');
      expect(reboot?.operationalRules).toContain('Obrigatório passar confirm: true para autorizar o reinício.');

      // Verify tool call
      const manualResult = await callMcpServerTool({
        server: serverConfig,
        toolName: 'get_tool_manual',
        arguments: { tool_name: 'configure_wifi' },
      });

      expect(manualResult.content).toEqual([{ type: 'text', text: '# Manual Técnico: configure_wifi\n\nRegras de ouro...' }]);
      expect((manualResult as any).structuredContent).toEqual({ tool: 'configure_wifi', version: '2.1.0' });
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it('connects to live ACS MCP server on :8090 and pulls all 9 tools successfully', async () => {
    const liveServer: McpServerConfig = {
      id: 'live-acs-server',
      name: 'ACS Live Router MCP',
      url: 'http://127.0.0.1:8090/mcp',
      transport: 'direct_http',
      isActive: true,
    };

    try {
      const tools = await listMcpServerTools(liveServer);
      expect(tools.length).toBe(9);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('list_routers');
      expect(toolNames).toContain('get_router_details');
      expect(toolNames).toContain('get_wifi_diagnostics');
      expect(toolNames).toContain('configure_wifi');
      expect(toolNames).toContain('list_connected_clients');
      expect(toolNames).toContain('scan_wifi_spectrum');
      expect(toolNames).toContain('reboot_router');
      expect(toolNames).toContain('get_operation_status');
      expect(toolNames).toContain('get_tool_manual');

      // Test live call to get_tool_manual for index
      const manualRes = await callMcpServerTool({
        server: liveServer,
        toolName: 'get_tool_manual',
        arguments: {},
      });

      expect(manualRes.isError).toBe(false);
      expect((manualRes as any).content[0].text).toContain('Biblioteca "Como Usar"');
      expect((manualRes as any).structuredContent?.tools?.length).toBe(8);
    } catch (err: any) {
      if (err.message.includes('ECONNREFUSED')) {
        console.warn('Live server not available, skipping live test.');
        return;
      }
      throw err;
    }
  });
});

