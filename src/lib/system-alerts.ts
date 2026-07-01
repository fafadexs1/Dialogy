import { z } from 'zod';

export const GLOBAL_ALERT_REALTIME_TOPIC = 'system:global-alert';
export const GLOBAL_ALERT_REALTIME_EVENT = 'global_alert_changed';
export const GLOBAL_ALERT_BROWSER_CHANNEL = 'dialogy:global-alert';
export const GLOBAL_ALERT_BROWSER_STORAGE_KEY = 'dialogy:global-alert:update';

const AlertLinkSchema = z.string().trim().max(2048, 'O link do comunicado e muito longo.').refine((value) => {
    if (!value) return true;
    if (value.startsWith('/')) return true;

    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}, 'Informe uma URL completa com http(s) ou um caminho interno iniciado por /.');

export const GlobalAlertSchema = z.object({
    message: z.string().trim().max(500, 'A mensagem do comunicado e muito longa.').default(''),
    color: z.enum(['yellow', 'green', 'red', 'blue']).default('yellow'),
    active: z.boolean().default(false),
    linkUrl: AlertLinkSchema.default(''),
});

export type GlobalAlertConfig = z.infer<typeof GlobalAlertSchema>;

export const globalAlertDefaultConfig: GlobalAlertConfig = {
    message: '',
    color: 'yellow',
    active: false,
    linkUrl: '',
};
