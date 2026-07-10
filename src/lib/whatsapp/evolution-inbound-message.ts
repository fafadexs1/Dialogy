export type EvolutionInboundDbMessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'location'
  | 'unsupported';

function pickFirstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function parseNativeFlowParams(paramsJson: unknown): Record<string, unknown> | undefined {
  if (typeof paramsJson !== 'string') return undefined;

  try {
    const parsed = JSON.parse(paramsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractEvolutionInteractiveResponseText(rawMessage: any): string | undefined {
  if (!rawMessage || typeof rawMessage !== 'object') return undefined;

  const buttonsResponse = rawMessage.buttonsResponseMessage;
  const templateButtonReply = rawMessage.templateButtonReplyMessage;
  const listResponse = rawMessage.listResponseMessage;
  const interactiveResponse = rawMessage.interactiveResponseMessage;
  const nativeFlowParams = parseNativeFlowParams(
    interactiveResponse?.nativeFlowResponseMessage?.paramsJson
  );

  return pickFirstNonEmptyString(
    buttonsResponse?.selectedDisplayText,
    buttonsResponse?.selectedButtonId,
    templateButtonReply?.selectedDisplayText,
    templateButtonReply?.selectedId,
    listResponse?.title,
    listResponse?.description,
    listResponse?.singleSelectReply?.selectedRowId,
    interactiveResponse?.body?.text,
    interactiveResponse?.nativeFlowResponseMessage?.name,
    nativeFlowParams?.title,
    nativeFlowParams?.text,
    nativeFlowParams?.name,
    nativeFlowParams?.id,
    nativeFlowParams?.selectedId,
    nativeFlowParams?.selectedRowId,
    nativeFlowParams?.value
  );
}

export function resolveEvolutionInboundMessageType(params: {
  messageType?: unknown;
  rawMessage?: any;
  hasLocation?: boolean;
  hasSharedContacts?: boolean;
}): string | undefined {
  const explicitType =
    typeof params.messageType === 'string' ? params.messageType.trim() : '';

  if (explicitType) {
    return explicitType;
  }

  const rawMessage = params.rawMessage;
  if (!rawMessage || typeof rawMessage !== 'object') {
    if (params.hasLocation) return 'locationMessage';
    if (params.hasSharedContacts) return 'contactMessage';
    return undefined;
  }

  if (rawMessage.audioMessage) return 'audioMessage';
  if (rawMessage.imageMessage) return 'imageMessage';
  if (rawMessage.videoMessage) return 'videoMessage';
  if (rawMessage.documentMessage) return 'documentMessage';
  if (rawMessage.locationMessage || params.hasLocation) return 'locationMessage';
  if (rawMessage.contactMessage || params.hasSharedContacts) return 'contactMessage';
  if (rawMessage.contactsArrayMessage) return 'contactsArrayMessage';
  if (rawMessage.buttonsResponseMessage) return 'buttonsResponseMessage';
  if (rawMessage.templateButtonReplyMessage) return 'templateButtonReplyMessage';
  if (rawMessage.listResponseMessage) return 'listResponseMessage';
  if (rawMessage.interactiveResponseMessage) return 'interactiveResponseMessage';
  if (rawMessage.buttonMessage) return 'buttonMessage';
  if (rawMessage.extendedTextMessage) return 'extendedTextMessage';
  if (rawMessage.conversation) return 'conversation';

  return undefined;
}

export function mapEvolutionInboundMessageTypeToDbType(
  messageType: unknown
): EvolutionInboundDbMessageType {
  const normalizedType = typeof messageType === 'string' ? messageType.trim() : '';

  if (!normalizedType) return 'text';

  switch (normalizedType) {
    // Standard WhatsApp conversational and interactive payloads are text.
    case 'conversation':
    case 'extendedTextMessage':
    case 'buttonMessage':
    case 'buttonsResponseMessage':
    case 'templateButtonReplyMessage':
    case 'listResponseMessage':
    case 'interactiveResponseMessage':
    case 'contactMessage':
    case 'contactsArrayMessage':
      return 'text';
    case 'audioMessage':
      return 'audio';
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'documentMessage':
      return 'document';
    case 'locationMessage':
      return 'location';
    default:
      return 'unsupported';
  }
}

export function shouldAppendInboundToClosedWhatsappChat(params: {
  closedAt?: Date | number | string | null;
  messageCreatedAt: Date | number | string;
}): boolean {
  const closedAtMs = new Date(params.closedAt ?? 0).getTime();
  const messageCreatedAtMs = new Date(params.messageCreatedAt).getTime();

  if (!Number.isFinite(closedAtMs) || !Number.isFinite(messageCreatedAtMs)) {
    return false;
  }

  return messageCreatedAtMs <= closedAtMs;
}
