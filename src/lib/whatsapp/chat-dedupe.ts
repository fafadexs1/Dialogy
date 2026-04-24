import { getWhatsappThreadIdentityKey } from '@/lib/whatsapp/contact-identity';

const ACTIVE_CHAT_STATUSES = new Set(['gerais', 'atendimentos']);

export function getActiveWhatsappChatIdentityKey(
    status?: string | null,
    phoneOrJid?: string | null
): string | null {
    if (!status || !ACTIVE_CHAT_STATUSES.has(status)) {
        return null;
    }

    return getWhatsappThreadIdentityKey(phoneOrJid);
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
