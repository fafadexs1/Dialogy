import type { Contact } from '@/lib/types';

export const GOOGLE_ADS_CUSTOMER_MATCH_HEADERS = ['Email', 'Phone'] as const;

function escapeCsvCell(value: string): string {
    if (!/[",\r\n]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
}

export function normalizeGoogleAdsEmail(value?: string | null): string {
    const email = String(value || '').replace(/\s+/g, '').toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

export function normalizeGoogleAdsPhone(value?: string | null): string {
    const address = String(value || '').split('@')[0].split(':')[0];
    let digits = address.replace(/\D/g, '');

    if (!digits) return '';
    digits = digits.replace(/^00/, '');
    digits = digits.replace(/^0+(?=\d{10,11}$)/, '');

    if (digits.length === 10 || digits.length === 11) {
        digits = `55${digits}`;
    }

    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
}

export function buildGoogleAdsCustomerMatchCsv(contacts: Array<Partial<Contact>>) {
    const rows = contacts.flatMap(contact => {
        const email = normalizeGoogleAdsEmail(contact.email);
        const phone = normalizeGoogleAdsPhone(
            contact.phone_canonical || contact.phone || contact.phone_number_jid
        );

        if (!email && !phone) return [];
        return [[email, phone]];
    });

    const csv = [
        GOOGLE_ADS_CUSTOMER_MATCH_HEADERS.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(',')),
    ].join('\n');

    return {
        csv,
        exportedCount: rows.length,
        skippedCount: contacts.length - rows.length,
    };
}

export function sanitizeGoogleAdsCsvFilename(value: string): string {
    const slug = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return `${slug || 'lista-crm'}-google-ads.csv`;
}
