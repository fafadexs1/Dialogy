'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { normalizeSupabaseStorageUrl } from '@/lib/storage-url';
import { createClient } from '@/lib/supabase/server';

export type TicketData = {
    subject: string;
    category: string;
    priority: string;
    description: string;
};

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export type SupportUserSummary = {
    id: string;
    display_name: string;
    email: string | null;
    avatar_url: string | null;
};

export type SupportTicket = {
    id: string;
    user_id: string;
    subject: string;
    category: string;
    priority: string;
    status: TicketStatus;
    description: string;
    created_at: string;
    updated_at: string;
    requester: SupportUserSummary | null;
    last_staff_reply: SupportUserSummary | null;
    last_staff_reply_at: string | null;
};

export type SupportMessage = {
    id: string;
    ticket_id: string;
    user_id: string;
    message: string;
    is_staff: boolean;
    created_at: string;
    author: SupportUserSummary | null;
};

type AuthContext = {
    supabase: Awaited<ReturnType<typeof createClient>>;
    userId: string;
    isSuperAdmin: boolean;
};

type SupportUserRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
};

type SupportTicketRow = {
    id: string;
    user_id: string;
    subject: string;
    category: string;
    priority: string;
    status: TicketStatus;
    description: string;
    created_at: string | Date;
    updated_at: string | Date;
};

type TicketWithRequesterRow = SupportTicketRow & {
    requester_id: string;
    requester_full_name: string | null;
    requester_email: string | null;
    requester_avatar_url: string | null;
};

type LastStaffReplyRow = {
    ticket_id: string;
    created_at: string | Date;
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
};

type MessageWithAuthorRow = {
    id: string;
    ticket_id: string;
    user_id: string;
    message: string;
    is_staff: boolean;
    created_at: string | Date;
    author_id: string;
    author_full_name: string | null;
    author_email: string | null;
    author_avatar_url: string | null;
};

const TICKET_STATUS_VALUES = new Set<TicketStatus>(['open', 'in_progress', 'closed']);

function toIsoString(value: string | Date) {
    return value instanceof Date ? value.toISOString() : value;
}

function mapSupportUser(row?: Partial<SupportUserRow> | null): SupportUserSummary | null {
    if (!row?.id) {
        return null;
    }

    const email = row.email?.trim() || null;
    const fullName = row.full_name?.trim() || null;

    return {
        id: row.id,
        display_name: fullName || email || 'Usuario',
        email,
        avatar_url: normalizeSupabaseStorageUrl(row.avatar_url) || null,
    };
}

function mapTicket(
    row: SupportTicketRow,
    requester: SupportUserSummary | null,
    lastStaffReply?: LastStaffReplyRow | null
): SupportTicket {
    return {
        ...row,
        created_at: toIsoString(row.created_at),
        updated_at: toIsoString(row.updated_at),
        requester,
        last_staff_reply: mapSupportUser(
            lastStaffReply
                ? {
                    id: lastStaffReply.user_id,
                    full_name: lastStaffReply.full_name,
                    email: lastStaffReply.email,
                    avatar_url: lastStaffReply.avatar_url,
                }
                : null
        ),
        last_staff_reply_at: lastStaffReply ? toIsoString(lastStaffReply.created_at) : null,
    };
}

function mapMessage(row: MessageWithAuthorRow): SupportMessage {
    return {
        id: row.id,
        ticket_id: row.ticket_id,
        user_id: row.user_id,
        message: row.message,
        is_staff: row.is_staff,
        created_at: toIsoString(row.created_at),
        author: mapSupportUser({
            id: row.author_id,
            full_name: row.author_full_name,
            email: row.author_email,
            avatar_url: row.author_avatar_url,
        }),
    };
}

async function getAuthContext(): Promise<AuthContext | null> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return null;
    }

    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('is_superadmin')
        .eq('id', user.id)
        .maybeSingle();

    if (userError) {
        console.error('[support] Error fetching user role:', userError);
    }

    return {
        supabase,
        userId: user.id,
        isSuperAdmin: !!userData?.is_superadmin,
    };
}

async function canAccessTicket(
    ticketId: string,
    userId: string,
    isSuperAdmin: boolean
): Promise<boolean> {
    const result = await db.query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM support_tickets WHERE id = $1 LIMIT 1',
        [ticketId]
    );

    const ticket = result.rows[0];
    if (!ticket) {
        return false;
    }

    if (isSuperAdmin) {
        return true;
    }

    return ticket.user_id === userId;
}

export async function createTicket(data: TicketData) {
    const context = await getAuthContext();

    if (!context) {
        throw new Error('Unauthorized');
    }

    const { error } = await context.supabase.from('support_tickets').insert({
        user_id: context.userId,
        subject: data.subject,
        category: data.category,
        priority: data.priority,
        description: data.description,
        status: 'open',
    });

    if (error) {
        console.error('Create ticket error:', error);
        throw new Error('Failed to create ticket');
    }

    revalidatePath('/support/tickets');
    return { success: true };
}

export async function getTicketsWithPermissions(): Promise<{ tickets: SupportTicket[]; isSuperAdmin: boolean }> {
    const context = await getAuthContext();

    if (!context) {
        return { tickets: [], isSuperAdmin: false };
    }

    try {
        const params: string[] = [];
        const whereClause = context.isSuperAdmin ? '' : 'WHERE st.user_id = $1';

        if (!context.isSuperAdmin) {
            params.push(context.userId);
        }

        const ticketsRes = await db.query<SupportTicketRow>(
            `
            SELECT
                st.id,
                st.user_id,
                st.subject,
                st.category,
                st.priority,
                st.status,
                st.description,
                st.created_at,
                st.updated_at
            FROM support_tickets st
            ${whereClause}
            ORDER BY st.created_at DESC
            `,
            params
        );

        if (ticketsRes.rows.length === 0) {
            return { tickets: [], isSuperAdmin: context.isSuperAdmin };
        }

        const requesterIds = [...new Set(ticketsRes.rows.map((ticket) => ticket.user_id))];
        const ticketIds = ticketsRes.rows.map((ticket) => ticket.id);

        const [requestersRes, lastStaffReplyRes] = await Promise.all([
            db.query<SupportUserRow>(
                `
                SELECT id, full_name, email, avatar_url
                FROM users
                WHERE id = ANY($1::uuid[])
                `,
                [requesterIds]
            ),
            db.query<LastStaffReplyRow>(
                `
                SELECT DISTINCT ON (sm.ticket_id)
                    sm.ticket_id,
                    sm.created_at,
                    u.id AS user_id,
                    u.full_name,
                    u.email,
                    u.avatar_url
                FROM support_messages sm
                JOIN users u ON u.id = sm.user_id
                WHERE sm.ticket_id = ANY($1::uuid[])
                  AND sm.is_staff = TRUE
                ORDER BY sm.ticket_id, sm.created_at DESC
                `,
                [ticketIds]
            ),
        ]);

        const requesterMap = new Map(
            requestersRes.rows.map((row) => [row.id, mapSupportUser(row)])
        );
        const lastStaffReplyMap = new Map(lastStaffReplyRes.rows.map((row) => [row.ticket_id, row]));

        return {
            tickets: ticketsRes.rows.map((row) =>
                mapTicket(
                    row,
                    requesterMap.get(row.user_id) ?? null,
                    lastStaffReplyMap.get(row.id) ?? null
                )
            ),
            isSuperAdmin: context.isSuperAdmin,
        };
    } catch (error) {
        console.error('[getTicketsWithPermissions] Error fetching tickets:', error);
        return { tickets: [], isSuperAdmin: context.isSuperAdmin };
    }
}

export async function getTickets() {
    const { tickets } = await getTicketsWithPermissions();
    return tickets;
}

export async function getTicket(ticketId: string): Promise<SupportTicket | null> {
    const context = await getAuthContext();
    if (!context) return null;

    try {
        const ticketRes = await db.query<TicketWithRequesterRow>(
            `
            SELECT
                st.id,
                st.user_id,
                st.subject,
                st.category,
                st.priority,
                st.status,
                st.description,
                st.created_at,
                st.updated_at,
                u.id AS requester_id,
                u.full_name AS requester_full_name,
                u.email AS requester_email,
                u.avatar_url AS requester_avatar_url
            FROM support_tickets st
            JOIN users u ON u.id = st.user_id
            WHERE st.id = $1
            LIMIT 1
            `,
            [ticketId]
        );

        const ticket = ticketRes.rows[0];
        if (!ticket) {
            return null;
        }

        if (!context.isSuperAdmin && ticket.user_id !== context.userId) {
            return null;
        }

        const lastStaffReplyRes = await db.query<LastStaffReplyRow>(
            `
            SELECT
                sm.ticket_id,
                sm.created_at,
                u.id AS user_id,
                u.full_name,
                u.email,
                u.avatar_url
            FROM support_messages sm
            JOIN users u ON u.id = sm.user_id
            WHERE sm.ticket_id = $1
              AND sm.is_staff = TRUE
            ORDER BY sm.created_at DESC
            LIMIT 1
            `,
            [ticketId]
        );

        return mapTicket(
            {
                id: ticket.id,
                user_id: ticket.user_id,
                subject: ticket.subject,
                category: ticket.category,
                priority: ticket.priority,
                status: ticket.status,
                description: ticket.description,
                created_at: ticket.created_at,
                updated_at: ticket.updated_at,
            },
            mapSupportUser({
                id: ticket.requester_id,
                full_name: ticket.requester_full_name,
                email: ticket.requester_email,
                avatar_url: ticket.requester_avatar_url,
            }),
            lastStaffReplyRes.rows[0] ?? null
        );
    } catch (error) {
        console.error('[getTicket] Error fetching ticket:', error);
        return null;
    }
}

export async function getTicketMessages(ticketId: string): Promise<SupportMessage[]> {
    const context = await getAuthContext();
    if (!context) return [];

    const allowed = await canAccessTicket(ticketId, context.userId, context.isSuperAdmin);
    if (!allowed) {
        return [];
    }

    try {
        const messagesRes = await db.query<MessageWithAuthorRow>(
            `
            SELECT
                sm.id,
                sm.ticket_id,
                sm.user_id,
                sm.message,
                sm.is_staff,
                sm.created_at,
                u.id AS author_id,
                u.full_name AS author_full_name,
                u.email AS author_email,
                u.avatar_url AS author_avatar_url
            FROM support_messages sm
            JOIN users u ON u.id = sm.user_id
            WHERE sm.ticket_id = $1
            ORDER BY sm.created_at ASC
            `,
            [ticketId]
        );

        return messagesRes.rows.map(mapMessage);
    } catch (error) {
        console.error('Get messages error:', error);
        return [];
    }
}

export async function sendMessage(ticketId: string, message: string): Promise<{ success: boolean; message: SupportMessage | null }> {
    const context = await getAuthContext();
    if (!context) throw new Error('Unauthorized');

    const allowed = await canAccessTicket(ticketId, context.userId, context.isSuperAdmin);
    if (!allowed) {
        throw new Error('Unauthorized');
    }

    try {
        const insertRes = await db.query<MessageWithAuthorRow>(
            `
            WITH inserted AS (
                INSERT INTO support_messages (ticket_id, user_id, message, is_staff)
                VALUES ($1, $2, $3, $4)
                RETURNING id, ticket_id, user_id, message, is_staff, created_at
            )
            SELECT
                inserted.id,
                inserted.ticket_id,
                inserted.user_id,
                inserted.message,
                inserted.is_staff,
                inserted.created_at,
                u.id AS author_id,
                u.full_name AS author_full_name,
                u.email AS author_email,
                u.avatar_url AS author_avatar_url
            FROM inserted
            JOIN users u ON u.id = inserted.user_id
            `,
            [ticketId, context.userId, message, context.isSuperAdmin]
        );

        await db.query(
            `
            UPDATE support_tickets
            SET updated_at = $2
            WHERE id = $1
            `,
            [ticketId, new Date().toISOString()]
        );

        revalidatePath(`/support/tickets/${ticketId}`);
        revalidatePath('/support/tickets');

        return {
            success: true,
            message: insertRes.rows[0] ? mapMessage(insertRes.rows[0]) : null,
        };
    } catch (error) {
        console.error('Send message error:', error);
        throw new Error('Failed to send message');
    }
}

export async function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<{ success: boolean; error?: string }> {
    const context = await getAuthContext();
    if (!context) return { success: false, error: 'Usuario nao autenticado.' };
    if (!context.isSuperAdmin) return { success: false, error: 'Apenas superadmin pode alterar status de tickets.' };

    if (!TICKET_STATUS_VALUES.has(status)) {
        return { success: false, error: 'Status invalido.' };
    }

    const { data, error } = await context.supabase
        .from('support_tickets')
        .update({
            status,
            updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId)
        .select('id');

    if (error) {
        console.error('[updateTicketStatus] Error updating ticket:', error);
        return { success: false, error: 'Falha ao atualizar status do ticket.' };
    }
    if (!data || data.length === 0) {
        console.warn('[updateTicketStatus] No rows updated for ticket:', ticketId);
        return { success: false, error: 'Ticket nao encontrado ou sem permissao para alterar status.' };
    }

    revalidatePath('/support/tickets');
    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}

export async function deleteTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
    const context = await getAuthContext();
    if (!context) return { success: false, error: 'Usuario nao autenticado.' };
    if (!context.isSuperAdmin) return { success: false, error: 'Apenas superadmin pode excluir tickets.' };

    const { error: messagesError } = await context.supabase
        .from('support_messages')
        .delete()
        .eq('ticket_id', ticketId);

    if (messagesError) {
        console.error('[deleteTicket] Error deleting support messages:', messagesError);
        return { success: false, error: 'Falha ao excluir mensagens do ticket.' };
    }

    const { data, error } = await context.supabase
        .from('support_tickets')
        .delete()
        .eq('id', ticketId)
        .select('id');

    if (error) {
        console.error('[deleteTicket] Error deleting ticket:', error);
        return { success: false, error: 'Falha ao excluir ticket.' };
    }
    if (!data || data.length === 0) {
        console.warn('[deleteTicket] No rows deleted for ticket:', ticketId);
        return { success: false, error: 'Ticket nao encontrado ou sem permissao para excluir.' };
    }

    revalidatePath('/support/tickets');
    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}
