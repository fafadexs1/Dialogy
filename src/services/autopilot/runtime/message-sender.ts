import { sendAutomatedMessageAction } from '@/actions/messages';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';
import { db } from '@/lib/db';
import type { MessageMetadata } from '@/lib/types';
import { guardRepeatedConfirmationPrompt } from '@/services/autopilot/runtime/repetition-guard';
import {
  markAutopilotResponseBlockDelivered,
  markAutopilotResponseBlockSending,
  markAutopilotResponseDeliveryError,
  prepareAutopilotResponseDelivery,
  type AutopilotResponseTrace,
} from '@/services/autopilot/runtime/response-delivery';
import {
  UncertainProviderDeliveryError,
  waitForAutomatedProviderAcceptance,
} from '@/services/autopilot/runtime/provider-delivery';
import { assertAutopilotSourceMessageCurrent } from '@/services/autopilot/runtime/stale-source-guard';

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
         AND COALESCE(upper(api_message_status), '') NOT IN ('FAILED', 'ERROR')
         AND COALESCE(content, '') <> ''
         AND created_at >= NOW() - interval '15 minutes'
       ORDER BY created_at DESC
       LIMIT 8`,
      [chatId],
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
  metadata?: MessageMetadata;
}) {
  const message = await guardAutomatedMessage(input.chatId, input.message);
  if (!message) {
    throw new Error(
      `Resposta automatizada suprimida pelo guard de repeticao para o chat ${input.chatId}.`,
    );
  }

  const result = await sendAutomatedMessageAction(
    input.chatId,
    message,
    input.agentId,
    input.isSystemAgent,
    input.instanceName,
    input.metadata,
  );
  await waitForAutomatedProviderAcceptance({
    result,
    chatId: input.chatId,
  });
  return result;
}

/**
 * Sends an AI response as one or more separate WhatsApp message bubbles.
 *
 * A traced response is prepared durably before the first provider call. On a
 * retry, the original blocks are reused and already-persisted blocks are skipped.
 */
export async function sendMultiBlockResponse(
  chatId: string,
  formattedResponse: string,
  agentId: string,
  isSystemAgent: boolean,
  instanceName?: string,
  aiMessageBlocks?: string[] | null,
  responseTrace?: AutopilotResponseTrace,
): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
  await assertAutopilotSourceMessageCurrent({
    chatId,
    sourceMessageId: responseTrace?.sourceMessageId,
  });

  const sourceBlocks = (aiMessageBlocks && aiMessageBlocks.length >= 1)
    ? aiMessageBlocks
    : splitIntoMessageBlocks(formattedResponse);
  let blocks = sourceBlocks
    .map((block) => formatCustomerFacingAiResponse(block))
    .filter((block) => block.trim() !== '');

  if (blocks.length === 0) {
    blocks = [formatCustomerFacingAiResponse(formattedResponse)];
  }

  const delivery = responseTrace
    ? await prepareAutopilotResponseDelivery({
        trace: responseTrace,
        chatId,
        blocks,
      })
    : null;
  if (delivery) {
    blocks = delivery.blocks;
    if (delivery.status === 'sent') {
      return { success: true };
    }
    if (delivery.uncertainBlockIndexes?.size > 0) {
      throw new UncertainProviderDeliveryError(
        `A entrega ${delivery.id} possui blocos sem confirmacao definitiva do provedor: `
        + `${[...delivery.uncertainBlockIndexes].join(', ')}. Reenvio automatico bloqueado.`,
      );
    }
  }

  let lastResult: { success: boolean; error?: string; apiResponse?: any } = { success: true };
  for (let index = 0; index < blocks.length; index += 1) {
    if (delivery?.deliveredBlockIndexes.has(index)) continue;
    const block = blocks[index];
    const baseBuffer = index === 0 ? 800 : 500;
    const maxTypingDelay = blocks.length === 1 ? 3000 : 2500;
    const minTypingDelay = blocks.length === 1 ? 800 : 600;
    const typingDelay = Math.min(
      Math.max((block.length * 12) + baseBuffer, minTypingDelay),
      maxTypingDelay,
    );
    await new Promise((resolve) => setTimeout(resolve, typingDelay));
    await assertAutopilotSourceMessageCurrent({
      chatId,
      sourceMessageId: responseTrace?.sourceMessageId,
    });

    const deliveryMetadata: MessageMetadata | undefined = delivery && responseTrace
      ? {
          autopilotSourceMessageId: responseTrace.sourceMessageId || undefined,
          autopilotOrchestratorRunId: responseTrace.orchestratorRunId || undefined,
          autopilotResponseDeliveryId: delivery.id,
          autopilotResponseDeliveryKey: responseTrace.deliveryKey || 'primary',
          autopilotResponseBlockIndex: index,
          autopilotResponseBlockCount: blocks.length,
        }
      : undefined;

    try {
      if (delivery) {
        await markAutopilotResponseBlockSending({
          deliveryId: delivery.id,
          blockIndex: index,
        });
      }
      lastResult = assertAutomatedMessageSent(
        await sendGuardedAutomatedMessage({
          chatId,
          message: block,
          agentId,
          isSystemAgent,
          instanceName,
          metadata: deliveryMetadata,
        }),
        chatId,
      );
      if (delivery) {
        await markAutopilotResponseBlockDelivered({
          deliveryId: delivery.id,
          blockIndex: index,
          blockCount: blocks.length,
        });
      }
    } catch (error) {
      if (delivery) {
        await markAutopilotResponseDeliveryError({
          deliveryId: delivery.id,
          error,
        }).catch((deliveryError) => {
          console.error(
            '[AUTOPILOT_RESPONSE_DELIVERY] Failed to persist delivery error:',
            deliveryError,
          );
        });
      }
      throw error;
    }
  }
  return lastResult;
}
