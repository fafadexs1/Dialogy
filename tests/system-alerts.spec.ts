import { describe, expect, it } from 'vitest';

import { GlobalAlertSchema } from '@/lib/system-alerts';

describe('GlobalAlertSchema', () => {
    it('preenche linkUrl vazio quando o campo nao existe', () => {
        const parsed = GlobalAlertSchema.parse({
            active: true,
            color: 'yellow',
            message: 'Instabilidade identificada.',
        });

        expect(parsed.linkUrl).toBe('');
    });

    it('aceita caminhos internos e URLs externas seguras', () => {
        expect(GlobalAlertSchema.parse({
            active: true,
            color: 'blue',
            message: 'Manutencao programada.',
            linkUrl: '/status',
        }).linkUrl).toBe('/status');

        expect(GlobalAlertSchema.parse({
            active: true,
            color: 'blue',
            message: 'Manutencao programada.',
            linkUrl: 'https://status.example.com',
        }).linkUrl).toBe('https://status.example.com');
    });

    it('rejeita protocolos inseguros', () => {
        const result = GlobalAlertSchema.safeParse({
            active: true,
            color: 'red',
            message: 'Nao clique em links suspeitos.',
            linkUrl: 'javascript:alert(1)',
        });

        expect(result.success).toBe(false);
    });
});
