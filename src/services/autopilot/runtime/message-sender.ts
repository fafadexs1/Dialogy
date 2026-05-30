import { sendAutomatedMessageAction } from '@/actions/messages';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';

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
  const sourceBlocks = (aiMessageBlocks && aiMessageBlocks.length > 1)
    ? aiMessageBlocks
    : splitIntoMessageBlocks(formattedResponse);
  const blocks = sourceBlocks
    .map((block) => formatCustomerFacingAiResponse(block))
    .filter((block) => block.trim() !== '');

  if (blocks.length <= 1) {
    const singleMessage = blocks[0] || formatCustomerFacingAiResponse(formattedResponse);
    return assertAutomatedMessageSent(
      await sendAutomatedMessageAction(chatId, singleMessage, agentId, isSystemAgent, instanceName),
      chatId,
    );
  }

  let lastResult: { success: boolean; error?: string; apiResponse?: any } = { success: true };
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    lastResult = assertAutomatedMessageSent(
      await sendAutomatedMessageAction(chatId, blocks[i], agentId, isSystemAgent, instanceName),
      chatId,
    );
  }
  return lastResult;
}
