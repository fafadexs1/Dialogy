'use server';

import { assignChatToSelfAction, closeChatAction, transferChatAction } from './chats';
import { sendAgentMessageAction } from './messages';
import { getCurrentUser } from './user';
import { consumeRateLimit } from '@/lib/ratelimit';
import { logAction } from '@/lib/observability/logger';
import { reportServerError } from '@/lib/observability/errors';
import { assignChatSchema, closeChatSchema, transferChatSchema, sendAgentMessageSchema } from '@/lib/validation/chat-schemas';

export async function guardedAssignChat(chatId: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  const parsed = assignChatSchema.safeParse({ chatId });
  if (!parsed.success) {
    return { success: false, error: 'Dados da conversa invalidos.' };
  }

  const rate = consumeRateLimit(`assign:${currentUser.id}`, 10, 60_000);
  if (!rate.ok) {
    return { success: false, error: `Muitas atribuicoes seguidas. Tente em ${Math.ceil(rate.retryAfter / 1000)}s.` };
  }

  try {
    const result = await assignChatToSelfAction(chatId);
    if (result.success) {
      await logAction({
        workspaceId: currentUser.activeWorkspaceId,
        userId: currentUser.id,
        action: 'chat_assigned',
        payload: { chatId, mode: 'guarded' },
      });
    }
    return result;
  } catch (error) {
    await reportServerError('guarded_assign_chat', error, { chatId });
    return { success: false, error: 'Falha ao assumir atendimento.' };
  }
}

export async function guardedCloseChat(chatId: string, reasonTagId: string | null, notes: string | null, sendCloseMessage = true, additionalMetadata: Record<string, any> = {}) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  const parsed = closeChatSchema.safeParse({ chatId, reasonTagId, notes, sendCloseMessage, additionalMetadata });
  if (!parsed.success) {
    return { success: false, error: 'Dados de encerramento invalidos.' };
  }

  const rate = consumeRateLimit(`close:${currentUser.id}`, 30, 300_000);
  if (!rate.ok) {
    return { success: false, error: `Muitos encerramentos. Aguarde ${Math.ceil(rate.retryAfter / 1000)}s.` };
  }

  try {
    const result = await closeChatAction(chatId, reasonTagId, notes, sendCloseMessage, additionalMetadata);
    if (result.success) {
      await logAction({
        workspaceId: currentUser.activeWorkspaceId,
        userId: currentUser.id,
        action: 'chat_closed',
        payload: { chatId, reasonTagId, notes: !!notes },
      });
    }
    return result;
  } catch (error) {
    await reportServerError('guarded_close_chat', error, { chatId });
    return { success: false, error: 'Falha ao encerrar atendimento.' };
  }
}

export async function guardedTransferChat(input: { chatId: string; teamId?: string; agentId?: string }) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  const parsed = transferChatSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Dados invalidos para transferencia.' };
  }

  const rate = consumeRateLimit(`transfer:${currentUser.id}`, 20, 120_000);
  if (!rate.ok) {
    return { success: false, error: `Transferencias em excesso. Retorne em ${Math.ceil(rate.retryAfter / 1000)}s.` };
  }

  try {
    const result = await transferChatAction(input);
    if (result.success) {
      await logAction({
        workspaceId: currentUser.activeWorkspaceId,
        userId: currentUser.id,
        action: 'chat_transferred',
        payload: input,
      });
    }
    return result;
  } catch (error) {
    await reportServerError('guarded_transfer_chat', error, { chatId: input.chatId });
    return { success: false, error: 'Falha ao transferir atendimento.' };
  }
}

export async function guardedSendAgentMessage(chatId: string, content: string, tabId?: string | null, optimisticId?: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  const parsed = sendAgentMessageSchema.safeParse({ chatId, content, tabId, optimisticId });
  if (!parsed.success) {
    return { success: false, error: 'Mensagem invalida.' };
  }

  const rate = consumeRateLimit(`send:${currentUser.id}`, 60, 60_000);
  if (!rate.ok) {
    return { success: false, error: `Limite de envio atingido. Tente em ${Math.ceil(rate.retryAfter / 1000)}s.` };
  }

  try {
    const result = await sendAgentMessageAction(chatId, content, tabId ?? null, optimisticId);
    if (result.success) {
      await logAction({
        workspaceId: currentUser.activeWorkspaceId,
        userId: currentUser.id,
        action: 'chat_message_sent',
        payload: { chatId, optimisticId },
      });
    }
    return result;
  } catch (error) {
    await reportServerError('guarded_send_agent_message', error, { chatId });
    return { success: false, error: 'Falha ao enviar mensagem.' };
  }
}
