import type { Channel, Message } from "../types";

export type MobileRealtimeOperation = "INSERT" | "UPDATE" | "DELETE";

export type MobileRealtimeEnvelope = {
  operation: MobileRealtimeOperation;
  record: Record<string, any> | null;
  oldRecord: Record<string, any> | null;
};

export function parseMobileRealtimeEnvelope(event: any): MobileRealtimeEnvelope {
  const payload = event?.payload?.payload ?? event?.payload ?? {};
  const operation = payload.operation === "UPDATE" || payload.operation === "DELETE"
    ? payload.operation
    : "INSERT";
  return {
    operation,
    record: payload.record ?? null,
    oldRecord: payload.old_record ?? null,
  };
}

function normalizeStatus(value: unknown, fallback: Message["status"]): Message["status"] {
  if (typeof value !== "string") return fallback;
  switch (value.toLowerCase()) {
    case "read":
      return "read";
    case "delivered":
      return "delivered";
    case "sent":
      return "sent";
    default:
      return fallback;
  }
}

function normalizeChannel(value: unknown, fallback: Channel): Channel {
  return value === "messenger" || value === "telegram" || value === "instagram" || value === "whatsapp"
    ? value
    : fallback;
}

export function messageFromRealtimeRecord(
  record: Record<string, any>,
  chatId: string,
  fallbackChannel: Channel,
  existing?: Message,
): Message {
  return {
    id: String(record.id ?? existing?.id ?? ""),
    chatId,
    content: typeof record.content === "string" ? record.content : existing?.content ?? "",
    createdAt: record.created_at ?? existing?.createdAt ?? new Date().toISOString(),
    fromMe: typeof record.from_me === "boolean" ? record.from_me : existing?.fromMe ?? false,
    channel: normalizeChannel(record.platform ?? record.source_from_api, existing?.channel ?? fallbackChannel),
    status: normalizeStatus(record.api_message_status, existing?.status ?? "sent"),
    isSystem: record.type === undefined ? existing?.isSystem : record.type === "system",
  };
}

export function reconcileMobileRealtimeMessages(
  current: Message[],
  envelope: MobileRealtimeEnvelope,
  chatId: string,
  fallbackChannel: Channel,
): Message[] {
  const record = envelope.record;
  const oldRecord = envelope.oldRecord;
  const messageId = String(record?.id ?? oldRecord?.id ?? "");
  if (!messageId) return current;

  if (envelope.operation === "DELETE") {
    const next = current.filter((message) => message.id !== messageId);
    return next.length === current.length ? current : next;
  }

  const index = current.findIndex((message) => message.id === messageId);
  if (envelope.operation === "UPDATE" && index < 0) return current;
  const nextMessage = messageFromRealtimeRecord(record ?? {}, chatId, fallbackChannel, index >= 0 ? current[index] : undefined);
  if (envelope.operation === "INSERT" && (nextMessage.status === "pending" || nextMessage.status === "error")) {
    nextMessage.status = "sent";
  }

  if (index < 0) return [...current, nextMessage];
  const next = [...current];
  next[index] = nextMessage;
  return next;
}

export function mergeInitialMessagePage(
  pageMessages: Message[],
  currentMessages: Message[],
  idsPresentWhenRequestStarted: ReadonlySet<string>,
): Message[] {
  const byId = new Map(pageMessages.map((message) => [message.id, message]));
  for (const message of currentMessages) {
    const arrivedDuringRequest = !idsPresentWhenRequestStarted.has(message.id);
    const isLocal = message.status === "pending" || message.status === "error";
    if (arrivedDuringRequest || isLocal) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDiff || a.id.localeCompare(b.id);
  });
}

export function upsertMobileMessage(current: Message[], message: Message): Message[] {
  const index = current.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...current, message];
  const next = [...current];
  next[index] = { ...current[index], ...message };
  return next;
}
