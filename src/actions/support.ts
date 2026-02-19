'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export type TicketData = {
    subject: string;
    category: string;
    priority: string;
    description: string;
};

export type TicketStatus = 'open' | 'in_progress' | 'closed';

type AuthContext = {
    supabase: Awaited<ReturnType<typeof createClient>>;
    userId: string;
    isSuperAdmin: boolean;
};

const TICKET_STATUS_VALUES = new Set<TicketStatus>(['open', 'in_progress', 'closed']);

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
    supabase: Awaited<ReturnType<typeof createClient>>,
    ticketId: string,
    userId: string,
    isSuperAdmin: boolean
): Promise<boolean> {
    const { data: ticket, error } = await supabase
        .from('support_tickets')
        .select('id, user_id')
        .eq('id', ticketId)
        .maybeSingle();

    if (error || !ticket) {
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

export async function getTicketsWithPermissions(): Promise<{ tickets: any[]; isSuperAdmin: boolean }> {
    const context = await getAuthContext();

    if (!context) {
        return { tickets: [], isSuperAdmin: false };
    }

    let query = context.supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

    // Superadmin visualiza todos os tickets; usuário comum apenas os próprios.
    if (!context.isSuperAdmin) {
        query = query.eq('user_id', context.userId);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[getTicketsWithPermissions] Error fetching tickets:', error);
        return { tickets: [], isSuperAdmin: context.isSuperAdmin };
    }

    return { tickets: data ?? [], isSuperAdmin: context.isSuperAdmin };
}

export async function getTickets() {
    const { tickets } = await getTicketsWithPermissions();
    return tickets;
}

export async function getTicket(ticketId: string) {
    const context = await getAuthContext();
    if (!context) return null;

    const { data: ticket, error } = await context.supabase
        .from('support_tickets')
        .select('*')
        .eq('id', ticketId)
        .maybeSingle();

    if (error || !ticket) return null;

    if (!context.isSuperAdmin && ticket.user_id !== context.userId) {
        return null;
    }

    return ticket;
}

export async function getTicketMessages(ticketId: string) {
    const context = await getAuthContext();
    if (!context) return [];

    const allowed = await canAccessTicket(context.supabase, ticketId, context.userId, context.isSuperAdmin);
    if (!allowed) {
        return [];
    }

    const { data, error } = await context.supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Get messages error:', error);
        return [];
    }

    return data ?? [];
}

export async function sendMessage(ticketId: string, message: string) {
    const context = await getAuthContext();
    if (!context) throw new Error('Unauthorized');

    const allowed = await canAccessTicket(context.supabase, ticketId, context.userId, context.isSuperAdmin);
    if (!allowed) {
        throw new Error('Unauthorized');
    }

    const { error } = await context.supabase.from('support_messages').insert({
        ticket_id: ticketId,
        user_id: context.userId,
        message,
        is_staff: context.isSuperAdmin,
    });

    if (error) {
        console.error('Send message error:', error);
        throw new Error('Failed to send message');
    }

    await context.supabase
        .from('support_tickets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', ticketId);

    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}

export async function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<{ success: boolean; error?: string }> {
    const context = await getAuthContext();
    if (!context) return { success: false, error: 'Usuário não autenticado.' };
    if (!context.isSuperAdmin) return { success: false, error: 'Apenas superadmin pode alterar status de tickets.' };

    if (!TICKET_STATUS_VALUES.has(status)) {
        return { success: false, error: 'Status inválido.' };
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
        return { success: false, error: 'Ticket nÃ£o encontrado ou sem permissÃ£o para alterar status.' };
    }

    revalidatePath('/support/tickets');
    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}

export async function deleteTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
    const context = await getAuthContext();
    if (!context) return { success: false, error: 'Usuário não autenticado.' };
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
        return { success: false, error: 'Ticket nÃ£o encontrado ou sem permissÃ£o para excluir.' };
    }

    revalidatePath('/support/tickets');
    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}
