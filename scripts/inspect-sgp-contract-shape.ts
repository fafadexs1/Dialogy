import 'dotenv/config';

import { Pool } from 'pg';

const chatId = process.argv[2]?.trim();
const contractId = String(process.argv[3] || '').replace(/\D/g, '');

if (!chatId || !contractId) {
  throw new Error('Usage: tsx scripts/inspect-sgp-contract-shape.ts <chat-id> <contract-id>');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

function describeShape(value: unknown, path = 'root', depth = 0): string[] {
  if (depth > 8) return [`${path}:depth-limit`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${path}:array(empty)`];
    return describeShape(value[0], `${path}[]`, depth + 1);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, nested]) => describeShape(nested, `${path}.${key}`, depth + 1));
  }
  const type = value === null ? 'null' : typeof value;
  const length = typeof value === 'string' ? `(length=${value.length})` : '';
  return [`${path}:${type}${length}`];
}

function withApplicationCredentials(config: any, body: Record<string, unknown>) {
  if (!config?.appId || !config?.appToken) return body;
  return { ...body, app: config.appId, token: config.appToken };
}

async function postJson(url: string, token: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`SGP shape request failed: HTTP ${response.status}`);
  }
  return response.json();
}

function findContractCandidates(value: unknown): unknown[] {
  const candidates: unknown[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 7 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const ids = [
      record.id,
      record.contrato,
      record.contrato_id,
      record.clienteContrato,
    ].map((entry) => String(entry ?? '').replace(/\D/g, ''));
    if (ids.includes(contractId)) candidates.push(record);
    Object.values(record).forEach((entry) => visit(entry, depth + 1));
  };
  visit(value);
  return candidates;
}

function onlyDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

function documentValues(value: unknown): string[] {
  const documents: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 7 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, nested]) => {
      if (/(cpf|cnpj|document)/i.test(key) && ['string', 'number'].includes(typeof nested)) {
        const digits = onlyDigits(nested);
        if (digits) documents.push(digits);
      }
      visit(nested, depth + 1);
    });
  };
  visit(value);
  return documents;
}

function collectKeyValues(value: unknown, keyPattern: RegExp): string[] {
  const values: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 7 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, nested]) => {
      if (keyPattern.test(key) && ['string', 'number'].includes(typeof nested)) {
        values.push(String(nested));
      }
      visit(nested, depth + 1);
    });
  };
  visit(value);
  return values;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15_000,
  });
  try {
    const chat = await pool.query(
      `SELECT c.workspace_id, c.contact_id
         FROM chats c
        WHERE c.id = $1
        LIMIT 1`,
      [chatId],
    );
    if (!chat.rows[0]) throw new Error('Chat not found.');

    const integrations = await pool.query(
      `SELECT provider, config
         FROM workspace_integrations
        WHERE workspace_id = $1
          AND is_active = true
          AND (provider = 'sgp' OR provider LIKE 'sgp_user_%')
        ORDER BY CASE WHEN provider = 'sgp' THEN 0 ELSE 1 END, updated_at DESC`,
      [chat.rows[0].workspace_id],
    );
    const global = integrations.rows.find((row) => row.provider === 'sgp')?.config;
    const user = integrations.rows.find((row) => String(row.provider).startsWith('sgp_user_'))?.config;
    if (!global?.baseUrl || !global?.cpfFieldId || !user?.token) {
      throw new Error('SGP integration is incomplete.');
    }

    const cpf = await pool.query(
      `SELECT value
         FROM contact_custom_field_values
        WHERE contact_id = $1
          AND field_id = $2
        LIMIT 1`,
      [chat.rows[0].contact_id, global.cpfFieldId],
    );
    if (!cpf.rows[0]?.value) throw new Error('Mapped CPF/CNPJ not found.');

    const [support, ura] = await Promise.all([
      postJson(
        `${global.baseUrl}/api/suporte/contrato/list/`,
        user.token,
        withApplicationCredentials(global, { contrato_id: contractId }),
      ),
      postJson(
        `${global.baseUrl}/api/ura/clientes/`,
        user.token,
        withApplicationCredentials(global, {
          cpfcnpj: cpf.rows[0].value,
          exibir_conexao: 1,
        }),
      ),
    ]);

    const supportCandidates = findContractCandidates(support);
    const uraCandidates = findContractCandidates(ura);
    const supportClientIds = collectKeyValues(supportCandidates, /^cliente_id$/i);
    const uraClientIds = Array.isArray(ura?.clientes)
      ? ura.clientes.map((client: any) => String(client?.id ?? '')).filter(Boolean)
      : [];
    const relevantPattern = /(onu|ont|olt|serial|mac|login|ip|cto|equip|model|fabric|conexao|cpf|cnpj|document)/i;
    const supportShape = describeShape(supportCandidates[0] ?? support, 'support')
      .filter((entry) => relevantPattern.test(entry))
      .slice(0, 300);
    const uraShape = describeShape(uraCandidates[0] ?? ura, 'ura')
      .filter((entry) => relevantPattern.test(entry))
      .slice(0, 300);

    console.log(JSON.stringify({
      contractMatched: {
        support: supportCandidates.length > 0,
        ura: uraCandidates.length > 0,
      },
      supportOwnershipMatchesMappedDocument: documentValues(supportCandidates)
        .includes(onlyDigits(cpf.rows[0].value)),
      supportClientMatchesUraClient: supportClientIds
        .some((clientId) => uraClientIds.includes(clientId)),
      supportTopLevelKeys: supportCandidates[0] && typeof supportCandidates[0] === 'object'
        ? Object.keys(supportCandidates[0] as Record<string, unknown>).sort()
        : [],
      supportShape,
      uraShape,
      valuesRedacted: true,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
