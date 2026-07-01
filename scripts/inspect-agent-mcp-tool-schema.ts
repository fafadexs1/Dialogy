import 'dotenv/config';

import { Pool } from 'pg';

const agentName = String(process.argv[2] || '').trim();
const toolSuffix = String(process.argv[3] || '').trim().toLowerCase();

if (!agentName || !toolSuffix) {
  throw new Error('Usage: tsx scripts/inspect-agent-mcp-tool-schema.ts <agent-name> <tool-suffix>');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function main() {
  const result = await pool.query(
    `SELECT workspace_id, enabled_tool_names
       FROM autopilot_configs
      WHERE name ILIKE $1
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1`,
    [`%${agentName}%`],
  );
  if (result.rowCount !== 1) {
    throw new Error('Agent not found.');
  }

  const config = result.rows[0];
  const enabledNames = new Set(
    Array.isArray(config.enabled_tool_names)
      ? config.enabled_tool_names.map(String)
      : [],
  );
  const integration = await pool.query(
    `SELECT config
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = 'mcp'
      LIMIT 1`,
    [config.workspace_id],
  );
  const workspaceConfig = parseObject(integration.rows[0]?.config);
  const servers = Array.isArray(workspaceConfig.servers) ? workspaceConfig.servers : [];
  const matches = servers.flatMap((server: any) => (
    Array.isArray(server?.tools)
      ? server.tools.filter((tool: any) => {
        const qualifiedName = String(tool?.qualifiedName || '');
        return enabledNames.has(qualifiedName)
          && qualifiedName.toLowerCase().endsWith(`:${toolSuffix}`);
      })
      : []
  ));
  if (matches.length !== 1) {
    throw new Error(`Expected one enabled MCP tool matching suffix, found ${matches.length}.`);
  }

  const tool = matches[0];
  const schema = parseObject(tool.inputSchema);
  const properties = parseObject(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  console.log(JSON.stringify({
    tool: String(tool.qualifiedName || '').split(':').at(-1),
    description: String(tool.description || tool.title || '').slice(0, 500),
    fields: Object.entries(properties).map(([name, definition]) => {
      const field = parseObject(definition);
      return {
        name,
        type: field.type ?? null,
        required: required.has(name),
        title: typeof field.title === 'string' ? field.title : null,
        description: typeof field.description === 'string'
          ? field.description.slice(0, 300)
          : null,
      };
    }),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
