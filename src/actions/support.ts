'use server'

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export type TicketData = {
    subject: string;
    category: string;
    priority: string;
    description: string;
};

export async function createTicket(data: TicketData) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Unauthorized');
    }

    const { error } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        subject: data.subject,
        category: data.category,
        priority: data.priority,
        description: data.description,
        status: 'open'
    });

    if (error) {
        console.error('Create ticket error:', error);
        throw new Error('Failed to create ticket');
    }

    revalidatePath('/support/tickets');
    return { success: true };
}

export async function getTickets() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        console.log('[getTickets] No user found');
        return [];
    }

    console.log('[getTickets] Fetching for user:', user.id);

    // Check if superadmin
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('is_superadmin')
        .eq('id', user.id)
        .single();

    if (userError) {
        console.error('[getTickets] Error fetching user data:', userError);
    } else {
        console.log('[getTickets] User data:', userData);
    }

    let query = supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

    // If not superadmin, filter by user_id
    if (!userData?.is_superadmin) {
        console.log('[getTickets] Filtering by user_id');
        query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;

    if (error) {
        console.error('[getTickets] Error fetching tickets:', error);
        return [];
    }

    console.log(`[getTickets] Found ${data.length} tickets`);
    return data;
}

export async function getTicket(ticketId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: userData } = await supabase
        .from('users')
        .select('is_superadmin')
        .eq('id', user.id)
        .single();

    const { data: ticket, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('id', ticketId)
        .single();

    if (error || !ticket) return null;

    // Authorization check
    if (!userData?.is_superadmin && ticket.user_id !== user.id) {
        return null;
    }

    return ticket;
}

export async function getTicketMessages(ticketId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return [];

    // Simple security check (could be robust, but RLS handles the heavy lifting)
    // We trust RLS to filter out messages user shouldn't see
    const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Get messages error:', error);
        return [];
    }

    return data;
}

export async function sendMessage(ticketId: string, message: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error('Unauthorized');

    const { data: userData } = await supabase
        .from('users')
        .select('is_superadmin')
        .eq('id', user.id)
        .single();

    // RLS will enforce ticket ownership or admin status
    const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticketId,
        user_id: user.id,
        message: message,
        is_staff: !!userData?.is_superadmin // If superadmin, mark as staff reply
    });

    if (error) {
        console.error('Send message error:', error);
        throw new Error('Failed to send message');
    }

    // Update ticket updated_at
    await supabase
        .from('support_tickets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', ticketId);

    // If it's a staff reply, maybe change status to 'in_progress' or 'answered'? 
    // For now, let's keep it simple.

    revalidatePath(`/support/tickets/${ticketId}`);
    return { success: true };
}
