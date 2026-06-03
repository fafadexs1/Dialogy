import { sendAutomatedMessageAction } from '@/actions/messages';
import { db } from '@/lib/db';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';
import { guardRepeatedConfirmationPrompt } from '@/services/autopilot/runtime/repetition-guard';

function assertAutomatedMessageSent<T extends { success: boolean; error?: string }>(
  result: T,
  chatId: string,
): T {
  if (!result.success) {
    throw new Error(
      `Falha ao enviar resposta automatizada para o chat ${chatId}: ${result.error || 'erro desconhecido'}`,
    );
  }

  return result;
}

async function guardAutomatedMessage(chatId: string, message: string): Promise<string | null> {
  try {
    const { rows } = await db.query(
      `SELECT content
       FROM messages
       WHERE chat_id = $1
         AND from_me = true
         AND COALESCE(api_message_status, '') <> 'internal'
         AND COALESCE(content, '') <> ''
         AND created_at >= NOW() - interval '15 minutes'
       ORDER BY created_at DESC
       LIMIT 8`,
      [chatId]
    );
    const guarded = guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: rows.map((row: any) => String(row.content || '')),
    });
    if (guarded.action !== 'send') {
      console.warn(`[AUTOPILOT_LOOP_GUARD] chat=${chatId} action=${guarded.action}`);
    }
    return guarded.message;
  } catch (error) {
    console.warn('[AUTOPILOT_LOOP_GUARD] Failed to inspect recent responses:', error);
    return message;
  }
}

async function sendGuardedAutomatedMessage(input: {
  chatId: string;
  message: string;
  agentId: string;
  isSystemAgent: boolean;
  instanceName?: string;
}) {
  const message = await guardAutomatedMessage(input.chatId, input.message);
  if (!message) return { success: true };

  return sendAutomatedMessageAction(
    input.chatId,
    message,
    input.agentId,
    input.isSystemAgent,
    input.instanceName
  );
}

/**
 * Sends an AI response as one or more separate WhatsApp message bubbles.
 *
 * When `aiMessageBlocks` is provided, each block is sent as its own message.
 * Otherwise, the heuristic `splitIntoMessageBlocks` is applied as a fallback.
 */
export async function sendMultiBlockResponse(
  chatId: string,
  formattedResponse: string,
  agentId: string,
  isSystemAgent: boolean,
  instanceName?: string,
  aiMessageBlocks?: string[] | null,
): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
  const sourceBlocks = (aiMessageBlocks && aiMessageBlocks.length >= 1)
    ? aiMessageBlocks
    : splitIntoMessageBlocks(formattedResponse);
  const blocks = sourceBlocks
    .map((block) => formatCustomerFacingAiResponse(block))
    .filter((block) => block.trim() !== '');

  if (blocks.length <= 1) {
    const singleMessage = blocks[0] || formatCustomerFacingAiResponse(formattedResponse);

    // Simulação de digitação humana dinâmica (12ms por caractere + 800ms de reação)
    const typingDelay = Math.min(Math.max((singleMessage.length * 12) + 800, 800), 3000);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    return assertAutomatedMessageSent(
      await sendGuardedAutomatedMessage({
        chatId,
        message: singleMessage,
        agentId,
        isSystemAgent,
        instanceName,
      }),
      chatId,
    );
  }

  let lastResult: { success: boolean; error?: string; apiResponse?: any } = { success: true };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Simulação de digitação humana dinâmica por balão subsequente
    const baseBuffer = i === 0 ? 800 : 500;
    const typingDelay = Math.min(Math.max((block.length * 12) + baseBuffer, 600), 2500);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    lastResult = assertAutomatedMessageSent(
      await sendGuardedAutomatedMessage({
        chatId,
        message: block,
        agentId,
        isSystemAgent,
        instanceName,
      }),
      chatId,
    );
  }
  return lastResult;
}
