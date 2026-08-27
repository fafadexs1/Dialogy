export const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';
export const WHATSAPP_ALT_JID_SUFFIX = '@c.us';
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

export function extractWhatsappDigits(value?: string | null): string {
    return String(value ?? '')
        .trim()
        .replace(/@.*$/, '')
        .replace(/\D/g, '');
}

export function isResolvableWhatsappIdentity(value?: string | null): boolean {
    const rawValue = String(value ?? '').trim().toLowerCase();
    if (!rawValue) return false;
    if (rawValue.includes(':')) return false;

    if (
        rawValue.includes('@') &&
        !rawValue.endsWith(WHATSAPP_STANDARD_JID_SUFFIX) &&
        !rawValue.endsWith(WHATSAPP_ALT_JID_SUFFIX)
    ) {
        return false;
    }

    return extractWhatsappDigits(rawValue).length >= 8;
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

/**
 * Alterna a forma do celular brasileiro entre com e sem o nono dígito.
 * 556195215930 <-> 5561995215930. Retorna null se não for um celular BR.
 */
export function buildAlternateBrazilianDigits(digits: string): string | null {
    if (isBrazilianMobileWithoutNinthDigit(digits)) {
        return `${digits.slice(0, 4)}9${digits.slice(4)}`;
    }

    if (isBrazilianMobileWithNinthDigit(digits)) {
        return `${digits.slice(0, 4)}${digits.slice(5)}`;
    }

    return null;
}

export function normalizeWhatsappPhoneNumber(value?: string | null): string | null {
    if (!isResolvableWhatsappIdentity(value)) {
        return null;
    }

    const digits = extractWhatsappDigits(value);
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

    const rawDigits = extractWhatsappDigits(value);
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

export function buildWhatsappLookupDigits(value?: string | null): string[] {
    return [
        ...new Set(
            buildWhatsappLookupJids(value)
                .map((jid) => extractWhatsappDigits(jid))
                .filter(Boolean)
        ),
    ];
}

export function getWhatsappThreadIdentityKey(value?: string | null): string | null {
    const normalizedPhone = normalizeWhatsappPhoneNumber(value);
    return normalizedPhone ? `whatsapp:${normalizedPhone}` : null;
}

function resolveCanonicalContactPhone(
    contact: { phone?: string | null } | null | undefined,
    normalizedPhone: string
): string | null {
    const existingPhoneDigits = extractWhatsappDigits(contact?.phone);

    if (!existingPhoneDigits) {
        return normalizedPhone;
    }

    if (existingPhoneDigits === normalizedPhone) {
        return null;
    }

    const normalizedExistingPhone = normalizeWhatsappPhoneNumber(existingPhoneDigits);
    if (normalizedExistingPhone === normalizedPhone) {
        return normalizedPhone;
    }

    return null;
}

export async function findWhatsappChatByIdentity(
    client: QueryableClient,
    params: {
        workspaceId: string;
        phoneOrJid: string;
        statuses?: string[] | null;
        preferOpen?: boolean;
    }
) {
    const { workspaceId, phoneOrJid, statuses, preferOpen = false } = params;
    const normalizedJid = normalizeWhatsappJid(phoneOrJid);
    const lookupJids = buildWhatsappLookupJids(phoneOrJid);

    if (!normalizedJid || lookupJids.length === 0) {
        return null;
    }

    const statusFilter = statuses && statuses.length > 0 ? statuses : null;

    const chatRes = await client.query(
        `SELECT
            ch.*,
            c.phone_number_jid AS contact_phone_number_jid,
            GREATEST(
                COALESCE(lm.created_at, ch.created_at),
                COALESCE(ch.updated_at, ch.created_at),
                COALESCE(ch.assigned_at, ch.created_at),
                COALESCE(ch.closed_at, ch.created_at),
                ch.created_at
            ) AS chat_activity_at
         FROM chats ch
         JOIN contacts c
           ON c.id = ch.contact_id
          AND c.workspace_id = ch.workspace_id
         LEFT JOIN LATERAL (
            SELECT m.created_at
            FROM messages m
            WHERE m.chat_id = ch.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
         ) lm ON TRUE
         WHERE ch.workspace_id = $1
           AND c.phone_number_jid = ANY($2::text[])
           AND ($3::text[] IS NULL OR ch.status::text = ANY($3::text[]))
         ORDER BY
            CASE
                WHEN $4::boolean AND ch.status::text = 'atendimentos' THEN 0
                WHEN $4::boolean AND ch.status::text = 'gerais' THEN 1
                WHEN $4::boolean THEN 2
                ELSE 0
            END,
            CASE
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') AND c.phone_number_jid = $5 THEN 0
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') THEN 1
                WHEN c.phone_number_jid = $5 THEN 0
                ELSE 1
            END,
            CASE
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') AND ch.agent_id IS NOT NULL THEN 0
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') THEN 1
                ELSE 0
            END,
            CASE
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') THEN ch.created_at
                ELSE NULL
            END ASC NULLS LAST,
            CASE
                WHEN $4::boolean AND ch.status::text IN ('gerais', 'atendimentos') THEN ch.id::text
                ELSE NULL
            END ASC NULLS LAST,
            GREATEST(
                COALESCE(lm.created_at, ch.created_at),
                COALESCE(ch.updated_at, ch.created_at),
                COALESCE(ch.assigned_at, ch.created_at),
                COALESCE(ch.closed_at, ch.created_at),
                ch.created_at
            ) DESC,
            ch.created_at DESC
         LIMIT 1`,
        [workspaceId, lookupJids, statusFilter, preferOpen, normalizedJid]
    );

    return chatRes.rows[0] ?? null;
}

export async function resolveCanonicalWhatsappChatIdByIdentity(
    client: QueryableClient,
    params: {
        workspaceId: string;
        phoneOrJid?: string | null;
        currentChatId?: string | null;
    }
): Promise<string | null> {
    const normalizedJid = normalizeWhatsappJid(params.phoneOrJid);
    if (!normalizedJid) {
        return params.currentChatId ?? null;
    }

    const activeChat = await findWhatsappChatByIdentity(client, {
        workspaceId: params.workspaceId,
        phoneOrJid: normalizedJid,
        statuses: ['gerais', 'atendimentos'],
        preferOpen: true,
    });

    if (activeChat?.id) {
        return activeChat.id;
    }

    return params.currentChatId ?? null;
}

export async function resolveCanonicalWhatsappChatId(
    client: QueryableClient,
    chatId: string
): Promise<string | null> {
    const chatRes = await client.query(
        `SELECT
            ch.id,
            ch.workspace_id,
            ch.status,
            c.phone_number_jid
         FROM chats ch
         JOIN contacts c
           ON c.id = ch.contact_id
          AND c.workspace_id = ch.workspace_id
         WHERE ch.id = $1
         LIMIT 1`,
        [chatId]
    );

    if ((chatRes.rowCount ?? 0) === 0) {
        return null;
    }

    const chatRow = chatRes.rows[0];
    if (chatRow.status === 'encerrados') {
        return chatRow.id;
    }

    return resolveCanonicalWhatsappChatIdByIdentity(client, {
        workspaceId: chatRow.workspace_id,
        phoneOrJid: chatRow.phone_number_jid,
        currentChatId: chatRow.id,
    });
}

export async function lockWhatsappIdentityTransaction(
    client: QueryableClient,
    params: {
        workspaceId: string;
        phoneOrJid: string;
    }
): Promise<string | null> {
    const normalizedPhone = normalizeWhatsappPhoneNumber(params.phoneOrJid);
    if (!normalizedPhone) {
        return null;
    }

    await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [params.workspaceId, normalizedPhone]
    );

    return normalizedPhone;
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
    if (!contact?.id || !normalizedJid) {
        return contact;
    }

    const canonicalPhone = resolveCanonicalContactPhone(contact, normalizedPhone);
    const needsJidUpdate = contact.phone_number_jid !== normalizedJid;
    const needsPhoneUpdate = Boolean(canonicalPhone && String(contact.phone ?? '').trim() !== canonicalPhone);

    if (!needsJidUpdate && !needsPhoneUpdate) {
        return contact;
    }

    if (needsJidUpdate) {
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
            if (!needsPhoneUpdate) {
                return contact;
            }

            const phoneOnlyRes = await client.query(
                `UPDATE contacts
                 SET phone = $1,
                     updated_at = timezone('utc', now())
                 WHERE id = $2
                   AND workspace_id = $3
                 RETURNING *`,
                [canonicalPhone, contact.id, workspaceId]
            );

            return phoneOnlyRes.rows[0] ?? contact;
        }
    }

    const updatedContactRes = await client.query(
        `UPDATE contacts
         SET phone_number_jid = $1,
             phone = COALESCE($2, phone),
             updated_at = timezone('utc', now())
         WHERE id = $3
           AND workspace_id = $4
         RETURNING *`,
        [normalizedJid, canonicalPhone, contact.id, workspaceId]
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
    
    // Search by phone_canonical first (highly optimized)
    let contactRes = await client.query(
        `SELECT c.* FROM contacts c WHERE c.workspace_id = $1 AND c.phone_canonical = $2 LIMIT 1`,
        [workspaceId, normalizedPhone]
    );
    let contact = contactRes.rows[0] ?? null;

    if (!contact) {
        // Fallback to existing GIN lookup
        contact = await selectPreferredWhatsappContact(client, workspaceId, lookupJids, normalizedJid);
    }

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
