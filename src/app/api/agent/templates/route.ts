import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';

type AgentTemplateSummary = {
  instanceName: string;
  name: string;
  language: string;
  status?: string;
  bodyText?: string;
  bodyParameterCount: number;
};

function normalizeTemplates(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.templates)) return value.templates;
  return [];
}

function summarizeTemplate(instanceName: string, template: any): AgentTemplateSummary | null {
  const name = String(template?.name || '').trim();
  if (!name) return null;
  const body = Array.isArray(template?.components)
    ? template.components.find((component: any) => String(component?.type || '').toUpperCase() === 'BODY')
    : null;
  const bodyText = typeof body?.text === 'string' ? body.text : '';
  const positions = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));

  return {
    instanceName,
    name,
    language: String(template?.language || 'pt_BR'),
    status: template?.status ? String(template.status) : undefined,
    bodyText: bodyText || undefined,
    bodyParameterCount: positions.length > 0 ? Math.max(...positions) : 0,
  };
}

export async function GET(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Authorization token is required.' }, { status: 401 });
  }

  try {
    const agentResult = await db.query(
      `SELECT workspace_id, is_active
       FROM system_agents
       WHERE token = $1
       LIMIT 1`,
      [token]
    );
    if ((agentResult.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Invalid token.' }, { status: 403 });
    }
    const agent = agentResult.rows[0];
    if (!agent.is_active) {
      return NextResponse.json({ error: 'Agent is not active.' }, { status: 403 });
    }

    const instancesResult = await db.query(
      `SELECT instance_name
       FROM evolution_api_instances
       WHERE workspace_id = $1
         AND type = 'wa_cloud'
       ORDER BY instance_name ASC`,
      [agent.workspace_id]
    );

    const templateGroups = await Promise.all(instancesResult.rows.map(async row => {
      const instanceName = String(row.instance_name || '').trim();
      if (!instanceName) return [] as AgentTemplateSummary[];
      try {
        const config = await getEvolutionApiConfig(instanceName, { workspaceId: agent.workspace_id });
        if (!config) return [] as AgentTemplateSummary[];
        const response = await fetchEvolutionAPI(`/template/find/${instanceName}`, config);
        return normalizeTemplates(response)
          .map(template => summarizeTemplate(instanceName, template))
          .filter((template): template is AgentTemplateSummary => Boolean(template));
      } catch (error) {
        console.error(`[AGENT_TEMPLATES_API] Failed to load templates for ${instanceName}:`, error);
        return [] as AgentTemplateSummary[];
      }
    }));

    return NextResponse.json({ templates: templateGroups.flat() });
  } catch (error) {
    console.error('[AGENT_TEMPLATES_API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
