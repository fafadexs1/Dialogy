export const WHATSAPP_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function hasRecentWhatsappCustomerReply(
    lastCustomerMessageAt: Date | string | null | undefined,
    now: Date = new Date()
): boolean {
    if (!lastCustomerMessageAt) {
        return false;
    }

    const replyAt = lastCustomerMessageAt instanceof Date
        ? lastCustomerMessageAt
        : new Date(lastCustomerMessageAt);

    if (Number.isNaN(replyAt.getTime()) || Number.isNaN(now.getTime())) {
        return false;
    }

    return now.getTime() - replyAt.getTime() <= WHATSAPP_CUSTOMER_WINDOW_MS;
}
