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
  const interactiveMessage = rawMessage.interactiveMessage;
  const nativeFlowParams = parseNativeFlowParams(
    interactiveResponse?.nativeFlowResponseMessage?.paramsJson ??
    interactiveMessage?.nativeFlowResponseMessage?.paramsJson
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
    interactiveMessage?.body?.text,
    interactiveMessage?.nativeFlowResponseMessage?.name,
    nativeFlowParams?.title,
    nativeFlowParams?.text,
    nativeFlowParams?.name,
    nativeFlowParams?.id,
    nativeFlowParams?.selectedId,
    nativeFlowParams?.selectedRowId,
    nativeFlowParams?.value
  );
}

function parseRecord(value: unknown): Record<string, any> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, any>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

function normalizeInteractiveLabel(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

/**
 * WhatsApp Cloud may return only the visible (and truncated) row title while
 * preserving the outbound message id in contextInfo. Recover the opaque rowId
 * from the interactive payload persisted on that quoted outbound message.
 */
export function resolveEvolutionInteractiveSelectionFromQuotedMessage(
  selectedText: unknown,
  quotedMetadata: unknown,
): string | undefined {
  const metadata = parseRecord(quotedMetadata);
  const interactive = parseRecord(metadata?.interactivePayload);
  const selected = normalizeInteractiveLabel(selectedText);
  if (!interactive || !selected) return undefined;

  const candidates: Array<{ id: string; labels: string[] }> = [];
  const sections = Array.isArray(interactive.sections) ? interactive.sections : [];
  for (const section of sections) {
    const rows = Array.isArray(section?.rows) ? section.rows : [];
    for (const row of rows) {
      const id = String(row?.rowId || row?.id || '').trim();
      if (!id) continue;
      candidates.push({
        id,
        labels: [row?.title, row?.description].map(normalizeInteractiveLabel).filter(Boolean),
      });
    }
  }
  const cards = Array.isArray(interactive.cards) ? interactive.cards : [];
  const buttons = [
    ...(Array.isArray(interactive.buttons) ? interactive.buttons : []),
    ...cards.flatMap((card: any) => Array.isArray(card?.buttons) ? card.buttons : []),
  ];
  for (const button of buttons) {
    const id = String(button?.id || '').trim();
    if (!id) continue;
    candidates.push({
      id,
      labels: [button?.displayText, button?.title].map(normalizeInteractiveLabel).filter(Boolean),
    });
  }

  const matches = candidates.filter((candidate) => candidate.labels.includes(selected));
  return matches.length === 1 ? matches[0]!.id : undefined;
}

export function extractEvolutionInteractiveResponseId(rawMessage: any): string | undefined {
  if (!rawMessage || typeof rawMessage !== 'object') return undefined;

  const buttonsResponse = rawMessage.buttonsResponseMessage;
  const templateButtonReply = rawMessage.templateButtonReplyMessage;
  const listResponse = rawMessage.listResponseMessage;
  const interactiveResponse = rawMessage.interactiveResponseMessage;
  const interactiveMessage = rawMessage.interactiveMessage;
  const nativeFlowParams = parseNativeFlowParams(
    interactiveResponse?.nativeFlowResponseMessage?.paramsJson
    ?? interactiveMessage?.nativeFlowResponseMessage?.paramsJson
  );

  return pickFirstNonEmptyString(
    buttonsResponse?.selectedButtonId,
    templateButtonReply?.selectedId,
    listResponse?.singleSelectReply?.selectedRowId,
    nativeFlowParams?.selectedId,
    nativeFlowParams?.selectedRowId,
    nativeFlowParams?.id,
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
  if (rawMessage.interactiveMessage) return 'interactiveMessage';
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
    case 'interactiveMessage':
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
