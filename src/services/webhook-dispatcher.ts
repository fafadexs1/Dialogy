

'use server';

import { db } from '@/lib/db';
import type { Message, Chat, Contact, User, SystemAgent } from '@/lib/types';

interface WebhookPayload {
    event: 'message.created';
    account: {
        id: string; // workspace ID
        name: string;
    };
    conversation: {
        id: string; // chat ID
        status: Chat['status'];
        channel: string; // e.g., 'WhatsApp'
        instance_name: string;
        assigned_agent: {
            id: string | undefined;
            name: string | undefined;
        };
    };
    contact: {
        id: string;
        name: string;
        phone_number: string | undefined;
        email: string | undefined;
        avatar_url: string | undefined;
        custom_fields: Record<string, any>;
    };
    message: {
        id: string;
        content: string;
        type: Message['type'];
        from_me: boolean;
        created_at: string;
        metadata: Message['metadata'];
    };
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
    const res = await db.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    return res.rows[0]?.name || 'Unknown Workspace';
}

async function getContactWithCustomFields(contactId: string): Promise<Contact | null> {
    const res = await db.query(
        `SELECT 
            c.*,
            COALESCE(
                (SELECT json_object_agg(cfd.label, cfv.value)
                 FROM contact_custom_field_values cfv
                 JOIN custom_field_definitions cfd ON cfv.field_id = cfd.id
                 WHERE cfv.contact_id = c.id),
                '{}'::json
            ) as custom_fields
        FROM contacts c
        WHERE c.id = $1`,
        [contactId]
    );
    return res.rows[0] || null;
}

export async function dispatchMessageToWebhooks(
    chat: Chat, 
    message: Message,
    instanceName: string
) {
    console.log(`[WEBHOOK_DISPATCHER] Iniciando despacho para chat ${chat.id}, mensagem ${message.id}`);
    
    if (!chat.workspace_id) {
        console.error(`[WEBHOOK_DISPATCHER] Erro crítico: O objeto 'chat' não contém 'workspace_id'. Abortando.`);
        return;
    }

    const agents = await db.query('SELECT * FROM system_agents WHERE workspace_id = $1 AND is_active = TRUE AND webhook_url IS NOT NULL', [chat.workspace_id]);
    
    if (agents.rowCount === 0) {
        console.log(`[WEBHOOK_DISPATCHER] Nenhum agente ativo com webhook encontrado para o workspace ${chat.workspace_id}.`);
        return;
    }

    const workspaceName = await getWorkspaceName(chat.workspace_id);
    const contactWithDetails = await getContactWithCustomFields(chat.contact.id);

    if (!contactWithDetails) {
        console.error(`[WEBHOOK_DISPATCHER] Erro crítico: Não foi possível encontrar detalhes do contato ${chat.contact.id}. Abortando.`);
        return;
    }


    const payload: WebhookPayload = {
        event: 'message.created',
        account: {
            id: chat.workspace_id,
            name: workspaceName,
        },
        conversation: {
            id: chat.id,
            status: chat.status,
            channel: 'WhatsApp', // Placeholder
            instance_name: instanceName || 'N/A',
            assigned_agent: {
                id: chat.agent?.id,
                name: chat.agent?.name,
            },
        },
        contact: {
            id: contactWithDetails.id,
            name: contactWithDetails.name,
            phone_number: contactWithDetails.phone_number_jid,
            email: contactWithDetails.email,
            avatar_url: contactWithDetails.avatar_url,
            custom_fields: contactWithDetails.custom_fields || {},
        },
        message: {
            id: message.id,
            content: message.content,
            type: message.type,
            from_me: !!message.from_me,
            created_at: message.createdAt,
            metadata: message.metadata || {},
        },
    };

    for (const agent of agents.rows) {
        console.log(`[WEBHOOK_DISPATCHER] Enviando para o agente '${agent.name}' na URL: ${agent.webhook_url}`);
        fetch(agent.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dialogy-Token': agent.token,
            },
            body: JSON.stringify(payload),
        }).catch(error => {
            console.error(`[WEBHOOK_DISPATCHER] Falha ao enviar webhook para '${agent.name}':`, error);
        });
    }
}
