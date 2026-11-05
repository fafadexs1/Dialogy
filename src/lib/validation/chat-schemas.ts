import { z } from 'zod';

export const assignChatSchema = z.object({
  chatId: z.string().min(1),
});

export const closeChatSchema = z.object({
  chatId: z.string().min(1),
  reasonTagId: z.string().min(1).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  sendCloseMessage: z.boolean().optional(),
  additionalMetadata: z.record(z.any()).optional(),
});

export const transferChatSchema = z.object({
  operationId: z.string().min(1).max(200).optional(),
  expectedAgentId: z.string().nullable().optional(),
  expectedTeamId: z.string().nullable().optional(),
  expectedSystemAgentId: z.string().nullable().optional(),
  chatId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
});

export const sendAgentMessageSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
  tabId: z.string().optional().nullable(),
  optimisticId: z.string().optional(),
  skipUserSignature: z.boolean().optional(),
});
