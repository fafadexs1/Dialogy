import type { Contact } from '@/lib/types';
import { getWhatsappThreadIdentityKey } from '@/lib/whatsapp/contact-identity';

export type ContactThreadIdentity = {
    identityKey: string;
    contactIds: string[];
    phoneNumberJids: string[];
    primaryContactId: string;
    primaryContact: Contact;
};

export function getContactIdentitySource(contact: Pick<Contact, 'phone_number_jid' | 'phone'>): string | null {
    return contact.phone_number_jid || contact.phone || null;
}

function isPhoneLikeContactName(name?: string | null): boolean {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return true;
    if (trimmed.includes('@')) return true;

    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 8 && digits.length >= trimmed.replace(/\s/g, '').length * 0.7;
}

export function getContactThreadIdentityKey(contact: Contact): string {
    const whatsappKey = getWhatsappThreadIdentityKey(getContactIdentitySource(contact));
    if (whatsappKey) {
        return whatsappKey;
    }

    const email = contact.email?.trim().toLowerCase();
    if (email) {
        return `email:${email}`;
    }

    return `contact:${contact.id}`;
}

export function getContactThreadScore(contact: Contact): number {
    let score = 0;

    if (!isPhoneLikeContactName(contact.name)) score += 1000;
    if (contact.avatar_url) score += 100;
    if (contact.email) score += 50;
    if (contact.phone_number_jid) score += 25;
    if (contact.phone) score += 10;
    score += Math.min(String(contact.name ?? '').trim().length, 80) / 100;

    return score;
}

export function mergeEquivalentContacts(contacts: Contact[]): Contact[] {
    const groups = new Map<string, Contact[]>();
    const order: string[] = [];

    contacts.forEach((contact) => {
        const key = getContactThreadIdentityKey(contact);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)!.push(contact);
    });

    return order.map((key) => {
        const group = groups.get(key)!;
        const preferred = [...group].sort((a, b) => getContactThreadScore(b) - getContactThreadScore(a))[0];
        const relatedContactIds = [...new Set(group.map((contact) => contact.id).filter(Boolean))];
        const relatedPhoneNumberJids = [
            ...new Set(group.map((contact) => contact.phone_number_jid).filter(Boolean) as string[]),
        ];
        const firstWithEmail = group.find((contact) => contact.email);
        const firstWithAvatar = group.find((contact) => contact.avatar_url);
        const firstWithPhone = group.find((contact) => contact.phone);
        const firstWithPhoneJid = group.find((contact) => contact.phone_number_jid);

        return {
            ...preferred,
            avatar_url: preferred.avatar_url || firstWithAvatar?.avatar_url,
            email: preferred.email || firstWithEmail?.email,
            phone: preferred.phone || firstWithPhone?.phone,
            phone_number_jid: preferred.phone_number_jid || firstWithPhoneJid?.phone_number_jid,
            relatedContactIds,
            relatedPhoneNumberJids,
            relatedContactCount: relatedContactIds.length,
        };
    });
}

export function buildContactThreadIdentity(contacts: Contact[]): ContactThreadIdentity | null {
    if (!contacts.length) {
        return null;
    }

    const [mergedContact] = mergeEquivalentContacts(contacts);
    if (!mergedContact) {
        return null;
    }

    return {
        identityKey: getContactThreadIdentityKey(mergedContact),
        contactIds: mergedContact.relatedContactIds || [mergedContact.id],
        phoneNumberJids: mergedContact.relatedPhoneNumberJids || [],
        primaryContactId: mergedContact.id,
        primaryContact: mergedContact,
    };
}
