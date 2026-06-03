import type { Contact } from '@/lib/types';
import type { AutopilotExtractedSlots, AutopilotSlotName } from '@/services/autopilot/intent-types';
import type { SlotExtractionResult } from '@/services/autopilot/slots';
import type { AgentToolAction } from '@/services/agent-tools/types';

export type ResourceMapperFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'email'
  | 'phone'
  | 'select'
  | 'multi_select'
  | 'checkbox'
  | string;

export type ResourceFieldContract = {
  id: string;
  label: string;
  type: ResourceMapperFieldType;
  placeholder?: string | null;
  options?: unknown;
  aliases: string[];
};

export type ResourceSlotEvidence = {
  slot: AutopilotSlotName | string;
  value: string;
  source: 'message' | 'contact' | 'history' | 'model_payload' | 'inferred';
  confidence: number;
  requestedKey?: string | null;
};

export type ResourceFieldMapping = {
  resource: 'crm.contact.custom_fields';
  operation: 'update';
  slot: AutopilotSlotName | string;
  fieldId: string;
  fieldLabel: string;
  value: string;
  confidence: number;
  source: ResourceSlotEvidence['source'];
  reason: string;
};

export type ResourceMappingRejection = {
  slot: AutopilotSlotName | string;
  requestedKey?: string | null;
  value?: string | null;
  reason: string;
};

export type ResourceMappingResult = {
  resource: 'crm.contact.custom_fields';
  operation: 'update';
  mappedAction: Extract<AgentToolAction, { type: 'crm_update_contact_custom_fields' }> | null;
  mappings: ResourceFieldMapping[];
  rejected: ResourceMappingRejection[];
  status: 'mapped' | 'partial' | 'unmapped';
};

export type ResourceMappingInput = {
  workspaceId: string;
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  slotExtraction?: SlotExtractionResult | null;
  fields?: Record<string, unknown> | null;
  reason?: string | null;
};

export type ResourceMapperRuntimeContext = {
  workspaceId: string;
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  slots?: AutopilotExtractedSlots | null;
};
