'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireChatAccess } from '@/server/inbox/access';
import { db } from '@/lib/db';
import { consumeRateLimit } from '@/lib/ratelimit';
import { whatsappCatalogSchema } from '@/lib/whatsapp/catalog';
import { deliverWhatsappCatalog, getCatalogTarget } from '@/services/whatsapp/deliver-catalog';

async function authorize(chatId: string) {
  if (!z.string().uuid().safeParse(chatId).success) throw new Error('Conversa inválida.');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = await requireChatAccess(user?.id, chatId);
  if (!user || !access.ok) throw new Error(access.ok ? 'Usuário não autenticado.' : access.error);
  const { rows } = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
  if (!rows[0]?.workspace_id) throw new Error('Conversa não encontrada.');
  return { userId: user.id, workspaceId: String(rows[0].workspace_id) };
}

export async function getWhatsappCatalogAvailability(chatId: string): Promise<{ available: boolean; error?: string }> {
  try {
    const { workspaceId } = await authorize(chatId);
    await getCatalogTarget(chatId, workspaceId);
    return { available: true };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'Não foi possível verificar a conexão.' };
  }
}

export async function sendWhatsappCatalogAction(input: { chatId: string; requestId: string; catalog: unknown }) {
  try {
    const parsed = z.object({ chatId: z.string().uuid(), requestId: z.string().uuid(), catalog: whatsappCatalogSchema }).safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Catálogo inválido.' };
    const { userId, workspaceId } = await authorize(parsed.data.chatId);
    if (!consumeRateLimit(`catalog:${userId}`, 10, 60_000).ok) throw new Error('Limite de envio atingido. Aguarde um minuto.');
    return await deliverWhatsappCatalog({ ...parsed.data, workspaceId, senderUserId: userId });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao enviar catálogo.' };
  }
}
