import type { SlotExtractionResult } from '@/services/autopilot/slots';
import type { Contact } from '@/lib/types';
import type { AgentToolAction } from '@/services/agent-tools/types';
import { mapCrmContactCustomFields } from './crm-contact-custom-fields';
import type { ResourceMappingResult } from './types';
import { recordResourceMappingLedger } from './ledger';

export type ResourceMappedAgentActionsResult = {
  actions: AgentToolAction[];
  mappings: ResourceMappingResult[];
};

export async function mapAgentToolActionsToResources(input: {
  workspaceId: string;
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  slotExtraction?: SlotExtractionResult | null;
  actions: AgentToolAction[];
  enabledToolNames?: string[];
  inferCrmUpdateFromSlots?: boolean;
  chatId?: string | null;
  messageId?: string | null;
  procedureExecutionId?: string | null;
}): Promise<ResourceMappedAgentActionsResult> {
  const mappedActions: AgentToolAction[] = [];
  const mappings: ResourceMappingResult[] = [];
  let sawCrmUpdate = false;

  for (const action of input.actions) {
    if (action.type !== 'crm_update_contact_custom_fields') {
      mappedActions.push(action);
      continue;
    }
    sawCrmUpdate = true;

    const mapping = await mapCrmContactCustomFields({
      workspaceId: input.workspaceId,
      customerMessage: input.customerMessage,
      chatHistory: input.chatHistory,
      contact: input.contact,
      slotExtraction: input.slotExtraction,
      fields: action.payload?.fields || null,
      reason: action.reason,
    });
    mappings.push(mapping);
    if (input.chatId || input.messageId || input.procedureExecutionId) {
      await recordResourceMappingLedger({
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        messageId: input.messageId,
        procedureExecutionId: input.procedureExecutionId,
        mapping,
      });
    }

    if (mapping.mappedAction) {
      mappedActions.push(mapping.mappedAction);
    } else {
      mappedActions.push(action);
    }
  }

  if (
    input.inferCrmUpdateFromSlots &&
    !sawCrmUpdate &&
    (input.enabledToolNames || []).includes('crm_update_contact_custom_fields')
  ) {
    const inferredMapping = await mapCrmContactCustomFields({
      workspaceId: input.workspaceId,
      customerMessage: input.customerMessage,
      chatHistory: input.chatHistory,
      contact: input.contact,
      slotExtraction: input.slotExtraction,
      fields: null,
      reason: 'Resource Mapper inferiu atualizacao de CRM a partir de slots confiaveis do atendimento.',
    });
    if (inferredMapping.mappedAction) {
      mappings.push(inferredMapping);
      if (input.chatId || input.messageId || input.procedureExecutionId) {
        await recordResourceMappingLedger({
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          messageId: input.messageId,
          procedureExecutionId: input.procedureExecutionId,
          mapping: inferredMapping,
        });
      }
      mappedActions.unshift(inferredMapping.mappedAction);
    }
  }

  return { actions: mappedActions, mappings };
}
