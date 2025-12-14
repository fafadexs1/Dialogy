import { z } from 'zod';

export const assignChatSchema = z.object({
  chatId: z.string().min(1),
});

export const closeChatSchema = z.object({
  chatId: z.string().min(1),
  reasonTagId: z.string().min(1).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  sendCloseMessage: z.boolean().optional(),
});

export const transferChatSchema = z.object({
  chatId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
});

export const sendAgentMessageSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
  tabId: z.string().optional().nullable(),
  optimisticId: z.string().optional(),
});
