const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net';
const BRAZIL_COUNTRY_CODE = '55';
const BRAZIL_AREA_CODE_LENGTH = 2;
const ACTIVE_CHAT_STATUSES = new Set(['gerais', 'atendimentos']);

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

function normalizeWhatsappPhoneNumber(value?: string | null): string | null {
    const digits = extractDigits(value);
    if (!digits) return null;

    if (isBrazilianMobileWithoutNinthDigit(digits)) {
        return `${digits.slice(0, 4)}9${digits.slice(4)}`;
    }

    return digits;
}

function looksLikeWhatsappPhoneIdentity(value?: string | null): boolean {
    const rawValue = String(value ?? '').trim().toLowerCase();
    if (!rawValue) return false;

    if (rawValue.endsWith(WHATSAPP_JID_SUFFIX)) {
        return true;
    }

    return /^[0-9+\s().-]+$/.test(rawValue);
}

export function getActiveWhatsappChatIdentityKey(
    status?: string | null,
    phoneOrJid?: string | null
): string | null {
    if (!status || !ACTIVE_CHAT_STATUSES.has(status)) {
        return null;
    }

    if (!looksLikeWhatsappPhoneIdentity(phoneOrJid)) {
        return null;
    }

    const normalizedPhone = normalizeWhatsappPhoneNumber(phoneOrJid);
    if (!normalizedPhone) {
        return null;
    }

    return `whatsapp:${normalizedPhone}`;
}

export function dedupeActiveWhatsappChatsByIdentity<T>(options: {
    chats: T[];
    getId: (chat: T) => string;
    getStatus: (chat: T) => string | null | undefined;
    getPhoneOrJid: (chat: T) => string | null | undefined;
    preserveChatId?: string | null;
}): T[] {
    const { chats, getId, getStatus, getPhoneOrJid, preserveChatId = null } = options;

    if (chats.length <= 1) {
        return chats;
    }

    const winnerIdByIdentity = new Map<string, string>();
    let hasDuplicates = false;

    for (const chat of chats) {
        const identityKey = getActiveWhatsappChatIdentityKey(
            getStatus(chat),
            getPhoneOrJid(chat)
        );

        if (!identityKey) {
            continue;
        }

        if (!winnerIdByIdentity.has(identityKey)) {
            winnerIdByIdentity.set(identityKey, getId(chat));
            continue;
        }

        hasDuplicates = true;
    }

    if (!hasDuplicates) {
        return chats;
    }

    if (preserveChatId) {
        for (const chat of chats) {
            if (getId(chat) !== preserveChatId) {
                continue;
            }

            const identityKey = getActiveWhatsappChatIdentityKey(
                getStatus(chat),
                getPhoneOrJid(chat)
            );

            if (identityKey) {
                winnerIdByIdentity.set(identityKey, preserveChatId);
            }
            break;
        }
    }

    return chats.filter((chat) => {
        const identityKey = getActiveWhatsappChatIdentityKey(
            getStatus(chat),
            getPhoneOrJid(chat)
        );

        if (!identityKey) {
            return true;
        }

        return winnerIdByIdentity.get(identityKey) === getId(chat);
    });
}
