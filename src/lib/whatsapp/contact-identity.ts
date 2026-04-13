const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';
const BRAZIL_COUNTRY_CODE = '55';
const BRAZIL_AREA_CODE_LENGTH = 2;

type QueryableClient = {
    query: (
        text: string,
        values?: any[]
    ) => Promise<{
        rows: any[];
        rowCount?: number | null;
    }>;
};

function extractDigits(value?: string | null): string {
    return String(value ?? '')
        .trim()
        .replace(/@.*$/, '')
        .replace(/\D/g, '');
}

function getBrazilianSubscriberDigits(digits: string): string | null {
    if (!digits.startsWith(BRAZIL_COUNTRY_CODE)) return null;

    const localDigits = digits.slice(BRAZIL_COUNTRY_CODE.length);
    if (localDigits.length < BRAZIL_AREA_CODE_LENGTH + 8) return null;

    return localDigits.slice(BRAZIL_AREA_CODE_LENGTH);
}

function isBrazilianMobileWithoutNinthDigit(digits: string): boolean {
    if (digits.length !== 12) return false;

    const subscriberDigits = getBrazilianSubscriberDigits(digits);
    if (!subscriberDigits || subscriberDigits.length !== 8) return false;

    return /^[6-9]/.test(subscriberDigits);
}

function isBrazilianMobileWithNinthDigit(digits: string): boolean {
    if (digits.length !== 13) return false;

    const subscriberDigits = getBrazilianSubscriberDigits(digits);
    if (!subscriberDigits || subscriberDigits.length !== 9) return false;

    return /^9[6-9]/.test(subscriberDigits);
}

function buildAlternateBrazilianDigits(digits: string): string | null {
    if (isBrazilianMobileWithoutNinthDigit(digits)) {
        return `${digits.slice(0, 4)}9${digits.slice(4)}`;
    }

    if (isBrazilianMobileWithNinthDigit(digits)) {
        return `${digits.slice(0, 4)}${digits.slice(5)}`;
    }

    return null;
}

export function normalizeWhatsappPhoneNumber(value?: string | null): string | null {
    const digits = extractDigits(value);
    if (!digits) return null;

    if (isBrazilianMobileWithoutNinthDigit(digits)) {
        return `${digits.slice(0, 4)}9${digits.slice(4)}`;
    }

    return digits;
}

export function normalizeWhatsappJid(value?: string | null): string | null {
    const normalizedPhone = normalizeWhatsappPhoneNumber(value);
    if (!normalizedPhone) return null;

    return `${normalizedPhone}${WHATSAPP_STANDARD_JID_SUFFIX}`;
}

export function buildWhatsappLookupJids(value?: string | null): string[] {
    const normalizedPhone = normalizeWhatsappPhoneNumber(value);
    if (!normalizedPhone) return [];

    const lookupJids = new Set<string>([
        `${normalizedPhone}${WHATSAPP_STANDARD_JID_SUFFIX}`,
    ]);

    const rawDigits = extractDigits(value);
    if (rawDigits) {
        lookupJids.add(`${rawDigits}${WHATSAPP_STANDARD_JID_SUFFIX}`);

        const alternateDigits = buildAlternateBrazilianDigits(rawDigits);
        if (alternateDigits) {
            lookupJids.add(`${alternateDigits}${WHATSAPP_STANDARD_JID_SUFFIX}`);
        }
    }

    const alternateNormalizedDigits = buildAlternateBrazilianDigits(normalizedPhone);
    if (alternateNormalizedDigits) {
        lookupJids.add(`${alternateNormalizedDigits}${WHATSAPP_STANDARD_JID_SUFFIX}`);
    }

    return [...lookupJids];
}

async function selectPreferredWhatsappContact(
    client: QueryableClient,
    workspaceId: string,
    lookupJids: string[],
    normalizedJid: string
) {
    if (lookupJids.length === 0) {
        return null;
    }

    const contactRes = await client.query(
        `SELECT
            c.*,
            COALESCE(chat_stats.has_active_chat, FALSE) AS has_active_chat,
            chat_stats.last_chat_activity_at
         FROM contacts c
         LEFT JOIN LATERAL (
            SELECT
                BOOL_OR(ch.status IN ('gerais', 'atendimentos')) AS has_active_chat,
                MAX(COALESCE(ch.updated_at, ch.created_at)) AS last_chat_activity_at
            FROM chats ch
            WHERE ch.workspace_id = c.workspace_id
              AND ch.contact_id = c.id
         ) chat_stats ON TRUE
         WHERE c.workspace_id = $1
           AND c.phone_number_jid = ANY($2::text[])
         ORDER BY
            CASE WHEN COALESCE(chat_stats.has_active_chat, FALSE) THEN 0 ELSE 1 END,
            chat_stats.last_chat_activity_at DESC NULLS LAST,
            CASE WHEN c.phone_number_jid = $3 THEN 0 ELSE 1 END,
            c.updated_at DESC NULLS LAST,
            c.created_at ASC
         LIMIT 1`,
        [workspaceId, lookupJids, normalizedJid]
    );

    return contactRes.rows[0] ?? null;
}

async function alignContactToNormalizedJid(
    client: QueryableClient,
    workspaceId: string,
    contact: any,
    normalizedJid: string,
    normalizedPhone: string
) {
    if (!contact?.id || !normalizedJid || contact.phone_number_jid === normalizedJid) {
        return contact;
    }

    const conflictRes = await client.query(
        `SELECT 1
         FROM contacts
         WHERE workspace_id = $1
           AND phone_number_jid = $2
           AND id <> $3
         LIMIT 1`,
        [workspaceId, normalizedJid, contact.id]
    );

    if ((conflictRes.rowCount ?? 0) > 0) {
        return contact;
    }

    const updatedContactRes = await client.query(
        `UPDATE contacts
         SET phone_number_jid = $1,
             phone = COALESCE(NULLIF(phone, ''), $2),
             updated_at = timezone('utc', now())
         WHERE id = $3
           AND workspace_id = $4
         RETURNING *`,
        [normalizedJid, normalizedPhone, contact.id, workspaceId]
    );

    return updatedContactRes.rows[0] ?? contact;
}

export async function findOrCreateWhatsappContact(
    client: QueryableClient,
    params: {
        workspaceId: string;
        phoneOrJid: string;
        fallbackName?: string | null;
        fallbackPhone?: string | null;
        avatarUrl?: string | null;
    }
): Promise<{
    contact: any;
    created: boolean;
    normalizedJid: string;
    normalizedPhone: string;
    lookupJids: string[];
}> {
    const { workspaceId, phoneOrJid, fallbackName, fallbackPhone, avatarUrl = null } = params;

    const normalizedPhone = normalizeWhatsappPhoneNumber(phoneOrJid);
    const normalizedJid = normalizeWhatsappJid(phoneOrJid);

    if (!normalizedPhone || !normalizedJid) {
        throw new Error('Numero de WhatsApp invalido para resolucao de contato.');
    }

    const lookupJids = buildWhatsappLookupJids(phoneOrJid);
    let contact = await selectPreferredWhatsappContact(client, workspaceId, lookupJids, normalizedJid);

    if (contact) {
        contact = await alignContactToNormalizedJid(
            client,
            workspaceId,
            contact,
            normalizedJid,
            normalizedPhone
        );

        return {
            contact,
            created: false,
            normalizedJid,
            normalizedPhone,
            lookupJids,
        };
    }

    const contactName = String(fallbackName ?? '').trim() || normalizedPhone;
    const phoneValue = String(fallbackPhone ?? '').trim() || normalizedPhone;

    const insertRes = await client.query(
        `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, phone_number_jid) DO UPDATE
           SET name = contacts.name
         RETURNING *, (xmax = 0) AS inserted`,
        [workspaceId, contactName, phoneValue, normalizedJid, avatarUrl]
    );

    contact = insertRes.rows[0];

    return {
        contact,
        created: Boolean(contact?.inserted),
        normalizedJid,
        normalizedPhone,
        lookupJids,
    };
}
