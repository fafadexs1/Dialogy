import 'server-only';

import { createHash, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';

import { db } from '@/lib/db';
import { encryptPayload } from '@/services/meta/meta-payload-crypto';

type JsonRecord = Record<string, unknown>;

export interface MetaAtom {
  eventKey: string;
  field: string;
  phoneNumberId: string | null;
  wabaId: string;
  payload: JsonRecord;
}

interface FrozenRoute {
  clusterId: string;
  instanceId: string | null;
  instanceName: string | null;
  workspaceId: string | null;
  routeVersion: number;
}

interface RouteResolution {
  route: FrozenRoute | null;
  reason: string | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function atomicEnvelope(
  object: unknown,
  entry: JsonRecord,
  change: JsonRecord,
  value: unknown,
): JsonRecord {
  return {
    object,
    entry: [{ ...entry, changes: [{ ...change, value }] }],
  };
}

export function atomizeMetaWhatsappPayload(
  payload: JsonRecord,
  appId: string,
): MetaAtom[] {
  const atoms: MetaAtom[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const rawEntry of entries) {
    const entry = rawEntry as JsonRecord;
    const wabaId = typeof entry.id === 'string' ? entry.id : '';
    if (!wabaId) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const rawChange of changes) {
      const change = rawChange as JsonRecord;
      const field = typeof change.field === 'string' ? change.field : 'unknown';
      const value = (
        change.value && typeof change.value === 'object' ? change.value : {}
      ) as JsonRecord;
      const metadata = (
        value.metadata && typeof value.metadata === 'object'
          ? value.metadata
          : {}
      ) as JsonRecord;
      const phoneNumberId =
        typeof metadata.phone_number_id === 'string'
          ? metadata.phone_number_id
          : null;

      if (field === 'messages') {
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        const {
          messages: _messages,
          statuses: _statuses,
          contacts: _contacts,
          ...sharedValue
        } = value;

        for (const rawMessage of messages) {
          const message = rawMessage as JsonRecord;
          const messageId =
            typeof message.id === 'string'
              ? message.id
              : canonicalHash(message);
          const sender = typeof message.from === 'string' ? message.from : null;
          const matchingContacts = sender
            ? contacts.filter((item) => (item as JsonRecord).wa_id === sender)
            : [];
          const atomicValue: JsonRecord = {
            ...sharedValue,
            messages: [message],
          };
          if (matchingContacts.length > 0)
            atomicValue.contacts = matchingContacts;
          atoms.push({
            eventKey: `${appId}:${phoneNumberId ?? 'missing'}:${messageId}`,
            field,
            phoneNumberId,
            wabaId,
            payload: atomicEnvelope(payload.object, entry, change, atomicValue),
          });
        }

        for (const rawStatus of statuses) {
          const status = rawStatus as JsonRecord;
          const statusId =
            typeof status.id === 'string' ? status.id : canonicalHash(status);
          const statusName =
            typeof status.status === 'string' ? status.status : 'unknown';
          const timestamp =
            typeof status.timestamp === 'string' ? status.timestamp : 'unknown';
          atoms.push({
            eventKey: `${appId}:${phoneNumberId ?? 'missing'}:${statusId}:${statusName}:${timestamp}`,
            field,
            phoneNumberId,
            wabaId,
            payload: atomicEnvelope(payload.object, entry, change, {
              ...sharedValue,
              statuses: [status],
            }),
          });
        }

        if (messages.length === 0 && statuses.length === 0) {
          atoms.push({
            eventKey: canonicalHash({ appId, wabaId, field, value }),
            field,
            phoneNumberId,
            wabaId,
            payload: atomicEnvelope(payload.object, entry, change, value),
          });
        }
        continue;
      }

      const templateId = value.message_template_id ?? value.template_id;
      const eventName = value.event ?? value.status ?? 'unknown';
      const eventKey = templateId
        ? `${appId}:${wabaId}:${String(templateId)}:${String(eventName)}:${canonicalHash(value)}`
        : canonicalHash({ appId, wabaId, field, value });
      atoms.push({
        eventKey,
        field,
        phoneNumberId,
        wabaId,
        payload: atomicEnvelope(payload.object, entry, change, value),
      });
    }
  }

  return atoms;
}

async function resolveRoute(
  client: PoolClient,
  atom: MetaAtom,
): Promise<RouteResolution> {
  if (atom.phoneNumberId) {
    const result = await client.query(
      `SELECT p.waba_id,
              p.instance_id,
              p.workspace_id,
              p.status AS phone_status,
              w.cluster_id,
              w.status AS waba_status,
              w.version AS route_version,
              i.instance_name
       FROM public.meta_whatsapp_phone_routes p
       JOIN public.meta_whatsapp_waba_routes w ON w.waba_id = p.waba_id
       JOIN public.evolution_api_instances i ON i.id = p.instance_id
       WHERE p.phone_number_id = $1`,
      [atom.phoneNumberId],
    );
    if (result.rowCount !== 1)
      return { route: null, reason: 'missing_or_ambiguous_phone_route' };
    const row = result.rows[0];
    if (row.waba_id !== atom.wabaId)
      return { route: null, reason: 'phone_waba_ownership_mismatch' };
    if (row.phone_status !== 'active' || row.waba_status !== 'active') {
      return {
        route: null,
        reason:
          row.waba_status === 'migrating'
            ? 'route_migrating'
            : 'route_inactive',
      };
    }
    return {
      route: {
        clusterId: row.cluster_id,
        instanceId: row.instance_id,
        instanceName: row.instance_name,
        workspaceId: row.workspace_id,
        routeVersion: row.route_version,
      },
      reason: null,
    };
  }

  const result = await client.query(
    `SELECT cluster_id, status, version AS route_version
     FROM public.meta_whatsapp_waba_routes
     WHERE waba_id = $1`,
    [atom.wabaId],
  );
  if (result.rowCount !== 1)
    return { route: null, reason: 'missing_or_ambiguous_waba_route' };
  const row = result.rows[0];
  if (row.status !== 'active') {
    return {
      route: null,
      reason: row.status === 'migrating' ? 'route_migrating' : 'route_inactive',
    };
  }
  return {
    route: {
      clusterId: row.cluster_id,
      instanceId: null,
      instanceName: null,
      workspaceId: null,
      routeVersion: row.route_version,
    },
    reason: null,
  };
}

export async function persistMetaWhatsappEnvelope(
  rawBody: string,
  payload: JsonRecord,
  options: {
    appId?: string;
    shadow?: boolean;
    sourceClusterId?: string | null;
  } = {},
) {
  const client = await db.connect();
  const hashInput = options.shadow
    ? `shadow:${options.sourceClusterId ?? 'unknown'}:${rawBody}`
    : rawBody;
  const bodyHash = createHash('sha256').update(hashInput).digest('hex');
  const atoms = atomizeMetaWhatsappPayload(
    payload,
    options.appId || process.env.META_APP_ID || 'meta',
  );

  try {
    await client.query('BEGIN');
    const receipt = await client.query(
      `INSERT INTO public.meta_whatsapp_receipts
         (id, body_hash, encrypted_payload, signature_verified)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (body_hash) DO NOTHING
       RETURNING id`,
      [randomUUID(), bodyHash, encryptPayload(rawBody)],
    );

    if (receipt.rowCount === 0) {
      await client.query('COMMIT');
      return { duplicate: true, atoms: 0, quarantined: 0 };
    }

    let quarantined = 0;
    for (const atom of atoms) {
      const resolution = await resolveRoute(client, atom);
      const route = resolution.route;
      const shadowDivergence = Boolean(
        options.shadow &&
        route &&
        options.sourceClusterId &&
        route.clusterId !== options.sourceClusterId,
      );
      const status = options.shadow || !route ? 'quarantined' : 'pending';
      if (status === 'quarantined') quarantined += 1;
      await client.query(
        `INSERT INTO public.meta_whatsapp_deliveries
           (id, event_key, receipt_id, encrypted_payload, waba_id, phone_number_id,
            cluster_id, instance_id, workspace_id, route_version, status, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         ON CONFLICT (event_key) DO NOTHING`,
        [
          randomUUID(),
          options.shadow
            ? `shadow:${options.sourceClusterId ?? 'unknown'}:${atom.eventKey}`
            : atom.eventKey,
          receipt.rows[0].id,
          encryptPayload(JSON.stringify(atom.payload)),
          atom.wabaId,
          atom.phoneNumberId,
          route?.clusterId ?? null,
          route?.instanceId ?? null,
          route?.workspaceId ?? null,
          route?.routeVersion ?? null,
          status,
          options.shadow
            ? JSON.stringify({
                shadow: true,
                routing: resolution.reason,
                source_cluster_id: options.sourceClusterId ?? null,
                calculated_cluster_id: route?.clusterId ?? null,
                cluster_divergence: shadowDivergence,
              })
            : resolution.reason
              ? JSON.stringify({ routing: resolution.reason })
              : null,
        ],
      );
    }
    await client.query('COMMIT');
    return { duplicate: false, atoms: atoms.length, quarantined };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
