import 'server-only';

import { signDialogyRequest } from '@/services/meta/dialogy-hmac';

type JsonRecord = Record<string, unknown>;

export function isAtomicMetaEnvelope(payload: JsonRecord): boolean {
  if (
    payload.object !== 'whatsapp_business_account' ||
    !Array.isArray(payload.entry) ||
    payload.entry.length !== 1
  )
    return false;
  const entry = payload.entry[0];
  if (!entry || typeof entry !== 'object') return false;
  const changes = (entry as JsonRecord).changes;
  if (!Array.isArray(changes) || changes.length !== 1) return false;
  const change = changes[0];
  if (!change || typeof change !== 'object') return false;
  const typedChange = change as JsonRecord;
  if (
    typeof typedChange.field !== 'string' ||
    !typedChange.value ||
    typeof typedChange.value !== 'object'
  )
    return false;

  if (typedChange.field === 'messages') {
    const value = typedChange.value as JsonRecord;
    const metadata = value.metadata as JsonRecord | undefined;
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const statuses = Array.isArray(value.statuses) ? value.statuses : [];
    return (
      typeof metadata?.phone_number_id === 'string' &&
      messages.length + statuses.length === 1
    );
  }
  return true;
}

export function buildEvolutionRelayRequest(input: {
  delivery: JsonRecord;
  instanceName: string | null;
  providerInstanceId: string | null;
  payload: JsonRecord;
  timestamp: string;
  keyId: string;
  secret: string;
}) {
  if (!isAtomicMetaEnvelope(input.payload))
    throw new Error('invalid_atomic_meta_payload');
  if (input.delivery.phone_number_id && (!input.instanceName || !input.providerInstanceId))
    throw new Error('missing_provider_instance_identity');
  const deliveryId = String(input.delivery.id);
  const envelope = {
    deliveryId,
    eventKey: String(input.delivery.event_key),
    routeVersion: Number(input.delivery.route_version),
    target: {
      clusterId: String(input.delivery.cluster_id),
      // delivery.instance_id is a Dialogy FK, not the Evolution Instance.id.
      instanceId: input.providerInstanceId,
      instanceName: input.instanceName,
      workspaceId: input.delivery.workspace_id
        ? String(input.delivery.workspace_id)
        : null,
      phoneNumberId: input.delivery.phone_number_id
        ? String(input.delivery.phone_number_id)
        : null,
      wabaId: input.delivery.waba_id ? String(input.delivery.waba_id) : null,
    },
    payload: input.payload,
  };
  const rawBody = JSON.stringify(envelope);
  return {
    rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Dialogy-Key-Id': input.keyId,
      'X-Dialogy-Timestamp': input.timestamp,
      'X-Dialogy-Delivery-Id': deliveryId,
      'X-Dialogy-Signature': signDialogyRequest(
        input.secret,
        input.timestamp,
        deliveryId,
        rawBody,
      ),
    },
  };
}
