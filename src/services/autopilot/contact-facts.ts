import { db } from '@/lib/db';
import type { ExtractedSlotDetail } from './slots';

export type ContactFactPersistenceResult = {
  persisted: boolean;
  fields: Array<'name' | 'email' | 'address'>;
};

function currentMessageValue(
  details: ExtractedSlotDetail[],
  name: ExtractedSlotDetail['name'],
): string | null {
  const value = details.find((detail) => detail.name === name && detail.source === 'message')?.value;
  return value?.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
}

/**
 * Persists first-party contact facts as a control-plane operation. Phone is
 * intentionally excluded because the channel identifier must not be replaced
 * by a number mentioned in conversation.
 */
export async function persistAutopilotContactFacts(input: {
  workspaceId: string;
  contactId: string | null | undefined;
  details: ExtractedSlotDetail[];
  customerMessage: string;
}): Promise<ContactFactPersistenceResult> {
  if (!input.contactId) return { persisted: false, fields: [] };

  const explicitName = /(?:^|\b)(?:meu nome(?: completo)?\s*(?:e|é)\s+|nome(?: completo)?\s*[:=]\s*|sou\s+|me chamo\s+)/i.test(input.customerMessage);
  const explicitFullAddress = /\b(?:meu endereco|meu endereço|endereco completo|endereço completo|endereco\s*[:=]|endereço\s*[:=]|moro (?:na|no|em)|rua|avenida|quadra|lote|bairro|morada)\b/i.test(input.customerMessage);
  const name = explicitName ? currentMessageValue(input.details, 'name') : null;
  const email = currentMessageValue(input.details, 'email');
  const extractedAddress = currentMessageValue(input.details, 'address');
  const address = explicitFullAddress && extractedAddress && !/^CEP\s/i.test(extractedAddress)
    ? extractedAddress
    : null;
  const fields: ContactFactPersistenceResult['fields'] = [];
  if (name) fields.push('name');
  if (email) fields.push('email');
  if (address) fields.push('address');
  if (fields.length === 0) return { persisted: true, fields: [] };

  const result = await db.query(
    `UPDATE public.contacts
        SET name = COALESCE($3, name),
            email = COALESCE($4, email),
            address = COALESCE($5, address),
            updated_at = clock_timestamp()
      WHERE id = $1
        AND workspace_id = $2
      RETURNING id`,
    [input.contactId, input.workspaceId, name, email, address],
  );

  if ((result.rowCount || result.rows.length) === 0) {
    throw new Error('Contato do atendimento não foi encontrado para persistir os dados coletados.');
  }
  return { persisted: true, fields };
}
