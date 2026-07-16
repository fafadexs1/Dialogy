import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

function parseConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getSGPRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/ura\/(?:clientes|liberacaopromessa)$/i, '');
}

function buildCustomersEndpoint(baseUrl: string): string {
  return `${getSGPRoot(baseUrl)}/api/ura/clientes/`;
}

function buildPaymentPromiseEndpoint(baseUrl: string): string {
  return `${getSGPRoot(baseUrl)}/api/ura/liberacaopromessa/`;
}

export async function GET(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Authorization token is required.' }, { status: 401 });

  try {
    const agentResult = await db.query(
      `SELECT workspace_id, is_active
       FROM system_agents
       WHERE token = $1
       LIMIT 1`,
      [token]
    );
    if ((agentResult.rowCount ?? 0) === 0) return NextResponse.json({ error: 'Invalid token.' }, { status: 403 });
    const agent = agentResult.rows[0];
    if (!agent.is_active) return NextResponse.json({ error: 'Agent is not active.' }, { status: 403 });

    const integrationResult = await db.query(
      `SELECT config
       FROM workspace_integrations
       WHERE workspace_id = $1
         AND provider = 'sgp'
         AND is_active = true
       LIMIT 1`,
      [agent.workspace_id]
    );
    const config = parseConfig(integrationResult.rows[0]?.config);
    const baseUrl = String(config.baseUrl || '').trim();
    const app = String(config.appId || '').trim();
    const tokenValue = String(config.appToken || '').trim();
    if (!baseUrl || !app || !tokenValue) {
      return NextResponse.json({ error: 'A integração SGP da workspace está incompleta.' }, { status: 404 });
    }

    return NextResponse.json({
      endpoint: buildCustomersEndpoint(baseUrl),
      paymentPromiseEndpoint: buildPaymentPromiseEndpoint(baseUrl),
      app,
      token: tokenValue,
    });
  } catch (error) {
    console.error('[AGENT_SGP_CONFIG_API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
