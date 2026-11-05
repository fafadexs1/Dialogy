/** Only a real phone or a direct WhatsApp user JID can provide a phone number. */
export function studioContactPhone(contact: { phone?: string | null; phone_number_jid?: string | null }): string | undefined {
  const phone = contact.phone?.trim().replace(/[+\s().-]/g, '');
  if (phone && /^\d{10,15}$/.test(phone)) return phone;
  return contact.phone_number_jid?.match(/^(\d{10,15})@(?:s\.whatsapp\.net|c\.us)$/)?.[1];
}
