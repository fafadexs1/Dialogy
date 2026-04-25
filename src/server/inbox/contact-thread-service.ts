import 'server-only';

import { db } from '@/lib/db';
import type { Contact } from '@/lib/types';
import { buildContactThreadIdentity } from '@/lib/whatsapp/contact-thread';

type ContactRow = {
  id: string;
  workspace_id: string;
  name: string;
  avatar_url?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_number_jid?: string | null;
  phone_canonical?: string | null;
  address?: string | null;
  custom_fields?: Record<string, any> | null;
};

function mapContactRow(row: ContactRow): Contact {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    avatar_url: row.avatar_url || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    phone_number_jid: row.phone_number_jid || undefined,
    phone_canonical: row.phone_canonical || undefined,
    address: row.address || undefined,
    custom_fields: row.custom_fields || undefined,
  };
}

export type ContactThreadContext = {
  sourceContact: Contact;
  relatedContacts: Contact[];
  mergedContact: Contact;
  relatedContactIds: string[];
  lookupDigits: string[];
};

export async function loadContactThreadContext(
  workspaceId: string,
  contactId: string,
): Promise<ContactThreadContext | { error: string }> {
  const contactRes = await db.query(
    `
    SELECT id, workspace_id, name, avatar_url, email, phone, phone_number_jid, phone_canonical, address
    FROM contacts
    WHERE id = $1
      AND workspace_id = $2
    LIMIT 1
    `,
    [contactId, workspaceId]
  );
  const sourceContactRow = contactRes.rows[0] as ContactRow | undefined;

  if (!sourceContactRow) {
    return { error: 'Contato nao encontrado.' };
  }

  const relatedContactsRes = await db.query(
    `
    SELECT id, workspace_id, name, avatar_url, email, phone, phone_number_jid, address, phone_canonical
    FROM contacts
    WHERE workspace_id = $1
      AND id = $2
    LIMIT 1
    `,
    [workspaceId, contactId]
  );

  const relatedContacts = relatedContactsRes.rows.map(mapContactRow);
  const contactThread = buildContactThreadIdentity(relatedContacts);
  const mergedContact = contactThread?.primaryContact || relatedContacts[0];
  const relatedContactIds = [contactId];

  if (!mergedContact || relatedContactIds.length === 0) {
    return { error: 'Contato sem identidade valida para abrir historico.' };
  }

  return {
    sourceContact: mapContactRow(sourceContactRow),
    relatedContacts,
    mergedContact,
    relatedContactIds,
    lookupDigits: [],
  };
}
