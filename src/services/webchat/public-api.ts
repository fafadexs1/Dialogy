import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { getMonthlyChatLimitStatus } from '@/lib/billing-logic';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { processAutopilotForChat } from '@/services/autopilot-service';
import { createWebchatSessionToken, hashWebchatSessionToken } from './session-token';
import { isWebchatOriginAllowed, normalizeWebchatOrigin } from './origin';

export type PublicWebchatWidget = {
  id: string;
  workspaceId: string;
  publicKey: string;
  name: string;
  title: string;
  welcomeMessage: string;
  primaryColor: string;
  position: 'left' | 'right';
  allowedDomains: string[];
  requireName: boolean;
  requireEmail: boolean;
  autopilotConfigId: string | null;
  teamId: string | null;
};

export async function loadPublicWidget(publicKey: string): Promise<PublicWebchatWidget | null> {
  const result = await db.query(
    `SELECT id, workspace_id, public_key, name, title, welcome_message, primary_color, position,
            allowed_domains, require_name, require_email, autopilot_config_id, team_id
     FROM webchat_widgets WHERE public_key = $1 AND is_active = TRUE LIMIT 1`,
    [publicKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id, workspaceId: row.workspace_id, publicKey: row.public_key, name: row.name,
    title: row.title, welcomeMessage: row.welcome_message, primaryColor: row.primary_color,
    position: row.position, allowedDomains: row.allowed_domains || [], requireName: row.require_name,
    requireEmail: row.require_email, autopilotConfigId: row.autopilot_config_id, teamId: row.team_id,
  };
}

export async function createPublicSession(input: {
  widget: PublicWebchatWidget;
  visitorId?: string;
  origin?: string | null;
  currentUrl?: string | null;
  referrer?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  utm?: Record<string, string>;
}) {
  if (!isWebchatOriginAllowed(input.origin || null, input.widget.allowedDomains)) {
    throw new Error('origin_not_allowed');
  }
  const visitorId = input.visitorId?.trim().slice(0, 100) || randomUUID();
  const { token, hash } = createWebchatSessionToken();
  const id = randomUUID();
  await db.query(
    `INSERT INTO webchat_sessions
       (id, widget_id, workspace_id, visitor_id, token_hash, visitor_name, visitor_email, visitor_phone, origin, current_url, referrer, utm_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.widget.id, input.widget.workspaceId, visitorId, hash, input.name || null, input.email || null,
      input.phone || null, normalizeWebchatOrigin(input.origin), input.currentUrl || null, input.referrer || null, input.utm || {}],
  );
  return { sessionId: id, token, visitorId };
}

export async function authenticatePublicSession(sessionId: string, token: string) {
  const result = await db.query(
    `SELECT s.*, w.public_key, w.name AS widget_name, w.autopilot_config_id, w.team_id,
            w.require_name, w.require_email
     FROM webchat_sessions s JOIN webchat_widgets w ON w.id = s.widget_id
     WHERE s.id = $1 AND s.token_hash = $2 AND s.expires_at > NOW() AND w.is_active = TRUE LIMIT 1`,
    [sessionId, hashWebchatSessionToken(token)],
  );
  return result.rows[0] || null;
}

async function ensureConversation(session: any) {
  if (session.chat_id && session.contact_id) {
    const existing = await db.query('SELECT * FROM chats WHERE id = $1 AND status <> \'encerrados\' LIMIT 1', [session.chat_id]);
    if (existing.rows[0]) return { contactId: session.contact_id, chat: existing.rows[0], createdContact: false };
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const identity = `webchat:${session.widget_id}:${session.visitor_id}`;
    let contactRes = await client.query('SELECT * FROM contacts WHERE workspace_id=$1 AND phone_number_jid=$2 LIMIT 1', [session.workspace_id, identity]);
    const createdContact = !contactRes.rows[0];
    if (createdContact) {
      contactRes = await client.query(
        `INSERT INTO contacts (id, workspace_id, name, email, phone, phone_number_jid, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
        [randomUUID(), session.workspace_id, session.visitor_name || 'Visitante do site', session.visitor_email || null, session.visitor_phone || null, identity],
      );
    } else if (session.visitor_name || session.visitor_email || session.visitor_phone) {
      contactRes = await client.query(
        `UPDATE contacts SET name=COALESCE(NULLIF($2,''),name), email=COALESCE(NULLIF($3,''),email), phone=COALESCE(NULLIF($4,''),phone)
         WHERE id=$1 RETURNING *`,
        [contactRes.rows[0].id, session.visitor_name || '', session.visitor_email || '', session.visitor_phone || ''],
      );
    }
    const contact = contactRes.rows[0];
    let chatRes = await client.query(
      `SELECT * FROM chats WHERE workspace_id=$1 AND contact_id=$2 AND status <> 'encerrados' ORDER BY created_at DESC LIMIT 1`,
      [session.workspace_id, contact.id],
    );
    if (!chatRes.rows[0]) {
      const limit = await getMonthlyChatLimitStatus(session.workspace_id);
      if (!limit.allowed) throw new Error('chat_limit_reached');
      const systemAgent = session.autopilot_config_id
        ? (await client.query(
            `SELECT id FROM system_agents WHERE workspace_id=$1 AND autopilot_config_id=$2 AND is_active=TRUE ORDER BY created_at LIMIT 1`,
            [session.workspace_id, session.autopilot_config_id],
          )).rows[0]
        : null;
      const chatId = randomUUID();
      chatRes = await client.query(
        `INSERT INTO chats (id, workspace_id, contact_id, status, protocol, team_id, autopilot_config_id,
                            assigned_system_agent_id, is_autopilot_active, copilot_mode, last_activity_at)
         VALUES ($1,$2,$3,'gerais',$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
        [chatId, session.workspace_id, contact.id, chatId.slice(0, 8).toUpperCase(), session.team_id || null,
          session.autopilot_config_id || null, systemAgent?.id || null, Boolean(systemAgent), systemAgent ? 'auto' : 'off'],
      );
    }
    await client.query('UPDATE webchat_sessions SET contact_id=$2,chat_id=$3,last_seen_at=NOW(),updated_at=NOW() WHERE id=$1', [session.id, contact.id, chatRes.rows[0].id]);
    await client.query('COMMIT');
    return { contactId: contact.id, chat: chatRes.rows[0], createdContact };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function addPublicMessage(session: any, content: string) {
  const clean = content.trim().slice(0, 4000);
  if (!clean) throw new Error('empty_message');
  const recent = await db.query(
    `SELECT COUNT(*)::int AS total FROM messages WHERE workspace_id=$1 AND created_at > NOW() - INTERVAL '1 minute'
       AND metadata->>'webchatSessionId'=$2 AND from_me=FALSE`,
    [session.workspace_id, session.id],
  );
  if (Number(recent.rows[0]?.total || 0) >= 20) throw new Error('rate_limited');
  const conversation = await ensureConversation(session);
  const messageId = randomUUID();
  const messageRes = await db.query(
    `INSERT INTO messages (id,workspace_id,chat_id,type,content,from_me,is_read,api_message_status,instance_name,source_from_api,metadata,created_at)
     VALUES ($1,$2,$3,'text',$4,FALSE,FALSE,'RECEIVED',$5,'webchat',$6,NOW()) RETURNING *`,
    [messageId, session.workspace_id, conversation.chat.id, clean, session.widget_name, {
      webchatSessionId: session.id, visitorId: session.visitor_id, currentUrl: session.current_url,
      referrer: session.referrer, utm: session.utm_data,
    }],
  );
  await db.query('UPDATE chats SET last_activity_at=NOW(),updated_at=NOW() WHERE id=$1', [conversation.chat.id]);
  await db.query('UPDATE webchat_sessions SET last_seen_at=NOW(),updated_at=NOW() WHERE id=$1', [session.id]);
  await broadcastHydratedChatUpdate(session.workspace_id, conversation.chat.id);

  if (conversation.createdContact) {
    import('@/lib/automation-engine').then(({ evaluateAutomations }) => evaluateAutomations({
      type: 'contact_created', contactId: conversation.contactId, workspaceId: session.workspace_id,
      data: { name: session.visitor_name || 'Visitante do site', email: session.visitor_email },
    })).catch((error) => console.error('[WEBCHAT_AUTOMATION]', error));
  }
  if (conversation.chat.is_autopilot_active && clean) {
    const chatForAutopilot = {
      id: conversation.chat.id, workspace_id: session.workspace_id, status: conversation.chat.status,
      contact: { id: conversation.contactId, workspace_id: session.workspace_id, name: session.visitor_name || 'Visitante do site' },
      messages: [], is_autopilot_active: true, autopilot_config_id: conversation.chat.autopilot_config_id,
      assigned_system_agent_id: conversation.chat.assigned_system_agent_id, copilot_mode: 'auto',
    } as any;
    await processAutopilotForChat(session.workspace_id, chatForAutopilot, clean, session.widget_name, messageId);
  }
  return messageRes.rows[0];
}

export async function listPublicMessages(session: any, after?: string | null) {
  if (!session.chat_id) return [];
  const values: unknown[] = [session.chat_id, session.id];
  let afterClause = '';
  if (after) {
    values.push(after);
    afterClause = `AND m.created_at > $${values.length}::timestamptz`;
  }
  const result = await db.query(
    `SELECT m.id,m.type,m.content,m.from_me,m.api_message_status,m.created_at
     FROM messages m WHERE m.chat_id=$1
       AND COALESCE((m.metadata->>'isInternalNote')::boolean,FALSE)=FALSE
       AND (m.from_me=TRUE OR m.metadata->>'webchatSessionId'=$2)
       ${afterClause} ORDER BY m.created_at ASC LIMIT 200`,
    values,
  );
  await db.query('UPDATE webchat_sessions SET last_seen_at=NOW() WHERE id=$1', [session.id]);
  return result.rows.map((row) => ({
    id: row.id, type: row.type, content: row.content || '', fromMe: Boolean(row.from_me),
    status: row.api_message_status, createdAt: new Date(row.created_at).toISOString(),
  }));
}

