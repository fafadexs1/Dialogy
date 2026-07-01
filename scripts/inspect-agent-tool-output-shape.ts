import 'dotenv/config';

import { Pool } from 'pg';

const chatId = process.argv[2]?.trim();
if (!chatId) {
  throw new Error('Usage: tsx scripts/inspect-agent-tool-output-shape.ts <chat-id>');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

function describeShape(value: unknown, path = 'output'): string[] {
  if (typeof value === 'string' && path.endsWith('.text')) {
    try {
      return describeShape(JSON.parse(value), `${path}<json>`);
    } catch {
      // Non-JSON MCP text is represented only by type and length below.
    }
  }
  if (Array.isArray(value)) {
    const nested = value.slice(0, 5).flatMap((item) => describeShape(item, `${path}[]`));
    return nested.length > 0 ? nested : [`${path}:array(empty)`];
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${path}:object(empty)`];
    return entries.flatMap(([key, nested]) => describeShape(nested, `${path}.${key}`));
  }
  const type = value === null ? 'null' : typeof value;
  const length = typeof value === 'string' ? `(length=${value.length})` : '';
  return [`${path}:${type}${length}`];
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15_000,
  });
  try {
    const result = await pool.query(
      `SELECT tool_name, status, output
         FROM agent_tool_executions
        WHERE chat_id = $1
        ORDER BY created_at ASC`,
      [chatId],
    );
    console.log(JSON.stringify(result.rows.map((row) => ({
      toolName: String(row.tool_name),
      status: String(row.status),
      outputShape: describeShape(row.output).slice(0, 100),
    })), null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
