import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    channel: vi.fn(),
    createClient: vi.fn(),
    dbQuery: vi.fn(),
    getUser: vi.fn(),
    httpSend: vi.fn(),
    removeChannel: vi.fn(),
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    db: { query: mocks.dbQuery },
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: mocks.createClient,
}));

vi.mock('@/lib/supabase', () => ({
    getSupabaseAdmin: () => ({
        channel: mocks.channel,
        removeChannel: mocks.removeChannel,
    }),
}));

vi.mock('next/cache', () => ({
    revalidatePath: mocks.revalidatePath,
    revalidateTag: mocks.revalidateTag,
    unstable_cache: (callback: () => unknown) => callback,
}));

import { saveGlobalAlertAction } from '@/actions/system-alerts';
import {
    GLOBAL_ALERT_REALTIME_CHANNEL_OPTIONS,
    GLOBAL_ALERT_REALTIME_EVENT,
    GLOBAL_ALERT_REALTIME_TOPIC,
} from '@/lib/system-alerts';

describe('saveGlobalAlertAction realtime broadcast', () => {
    beforeEach(() => {
        mocks.channel.mockReset();
        mocks.createClient.mockReset();
        mocks.dbQuery.mockReset();
        mocks.getUser.mockReset();
        mocks.httpSend.mockReset();
        mocks.removeChannel.mockReset();
        mocks.revalidatePath.mockReset();
        mocks.revalidateTag.mockReset();

        mocks.createClient.mockResolvedValue({
            auth: { getUser: mocks.getUser },
        });
        mocks.getUser.mockResolvedValue({
            data: { user: { id: 'superadmin-1' } },
        });
        mocks.dbQuery
            .mockResolvedValueOnce({ rows: [{ is_superadmin: true }] })
            .mockResolvedValueOnce({ rows: [] });
        mocks.httpSend.mockResolvedValue({ success: true });
        mocks.channel.mockReturnValue({ httpSend: mocks.httpSend });
    });

    it('broadcasts updates to the same private channel used by the Inbox', async () => {
        const result = await saveGlobalAlertAction({
            active: true,
            color: 'yellow',
            linkUrl: '',
            message: 'Instabilidade identificada.',
        });

        expect(result).toEqual({ success: true });
        expect(mocks.channel).toHaveBeenCalledWith(
            GLOBAL_ALERT_REALTIME_TOPIC,
            GLOBAL_ALERT_REALTIME_CHANNEL_OPTIONS,
        );
        expect(mocks.httpSend).toHaveBeenCalledWith(
            GLOBAL_ALERT_REALTIME_EVENT,
            expect.objectContaining({
                alert: {
                    active: true,
                    color: 'yellow',
                    linkUrl: '',
                    message: 'Instabilidade identificada.',
                },
                updatedAt: expect.any(String),
            }),
        );
        expect(mocks.removeChannel).toHaveBeenCalled();
    });
});
