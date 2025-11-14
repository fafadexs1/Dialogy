'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import type { AutopilotConfig, NexusFlowInstance } from '@/lib/types';

type PreviewPayload = {
  workspaceId: string;
  message: string;
  agentId?: string;
  contactName?: string;
  contactEmail?: string;
  chatHistory?: string;
};

async function ensureMembership(userId: string, workspaceId: string): Promise<boolean> {
  const res = await db.query(
    'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2 LIMIT 1',
    [userId, workspaceId],
  );
  return res.rowCount > 0;
}

export async function POST(request: Request) {
  try {
    const payload: PreviewPayload = await request.json();
    const { workspaceId, message, contactName, contactEmail, chatHistory, agentId } = payload;

    if (!workspaceId || !message) {
      return NextResponse.json(
        { error: 'workspaceId e message são obrigatórios.' },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
    }

    if (!(await ensureMembership(user.id, workspaceId))) {
      return NextResponse.json({ error: 'Acesso não autorizado.' }, { status: 403 });
    }

    const configRes = await db.query(
      'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at',
      [workspaceId, user.id],
    );

    if (configRes.rowCount === 0) {
      return NextResponse.json(
        { error: 'Nenhuma configuração do Autopilot encontrada.' },
        { status: 404 },
      );
    }

    const agents = configRes.rows.map((row: any) => {
      const parsedDocs =
        typeof row.knowledge_base_documents === 'string'
          ? JSON.parse(row.knowledge_base_documents)
          : row.knowledge_base_documents || [];
      return {
        ...row,
        knowledge_base_documents: parsedDocs,
        is_active: Boolean(row.is_active),
        is_primary: Boolean(row.is_primary),
        default_fallback_reply: row.default_fallback_reply || null,
      } as AutopilotConfig;
    });

    const config =
      agents.find((a) => a.id === agentId) ||
      agents.find((a) => a.is_primary) ||
      agents[0];

    const rulesRes = await db.query(
      'SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name',
      [config.id],
    );

    const rules: NexusFlowInstance[] = rulesRes.rows.map((rule) => ({
      ...rule,
      action: typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action,
    }));

    const result = await generateAgentResponse({
      chatId: `preview-${Date.now()}`,
      customerMessage: message,
      chatHistory: chatHistory ?? '',
      rules: rules.filter((rule) => rule.enabled),
      knowledgeBase: config.knowledge_base || '',
      knowledgeBaseDocuments: config.knowledge_base_documents || [],
      fallbackReply: config.default_fallback_reply || '',
      model: config.ai_model || 'googleai/gemini-2.0-flash',
      contact: {
        id: `preview-contact-${Date.now()}`,
        name: contactName || 'Cliente em teste',
        email: contactEmail || '',
      },
      config,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[AUTOPILOT_TEST_API] Error running preview:', error);
    return NextResponse.json(
      { error: 'Falha ao executar o teste do agente.' },
      { status: 500 },
    );
  }
}
