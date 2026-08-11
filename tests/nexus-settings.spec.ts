import { describe, expect, it } from 'vitest';
import {
    buildWorkspaceManagedSettings,
    normalizeNexusSettings,
} from '@/lib/nexus-settings';

describe('normalizeNexusSettings', () => {
    it('treats a legacy row that only carries an e-mail as workspace managed', () => {
        // O formulario antigo do workspace gravava { email } sem mode nem
        // autoProvisioned. Lendo isso como conta vinculada, o SSO exigia um
        // usuario que nunca existiu no NexusFlow e o iframe caia no login.
        expect(normalizeNexusSettings({ email: 'time@empresa.com' }).mode).toBe('workspace_managed');
    });

    it('keeps the e-mail of the legacy row instead of discarding it', () => {
        expect(normalizeNexusSettings({ email: 'time@empresa.com' }).email).toBe('time@empresa.com');
    });

    it('only reports existing_account when the mode was explicitly stored', () => {
        const settings = normalizeNexusSettings({
            mode: 'existing_account',
            email: 'pessoa@empresa.com',
            nexusUserId: 'user-1',
        });
        expect(settings.mode).toBe('existing_account');
    });

    it('falls back to workspace managed for an empty or invalid value', () => {
        expect(normalizeNexusSettings(null).mode).toBe('workspace_managed');
        expect(normalizeNexusSettings('nao é um objeto').mode).toBe('workspace_managed');
    });
});

describe('buildWorkspaceManagedSettings', () => {
    it('reuses the identity already provisioned for the workspace', () => {
        const current = normalizeNexusSettings({
            mode: 'workspace_managed',
            email: 'ws_abc_123@nexus.dialogy.local',
            username: 'ws_abc_123',
            autoProvisioned: true,
        });

        const next = buildWorkspaceManagedSettings('workspace-1', current);

        expect(next.email).toBe('ws_abc_123@nexus.dialogy.local');
        expect(next.username).toBe('ws_abc_123');
    });

    it('reuses the e-mail of a legacy row so the workspace keeps its flows', () => {
        const current = normalizeNexusSettings({ email: 'time@empresa.com' });

        const next = buildWorkspaceManagedSettings('workspace-1', current);

        expect(next.email).toBe('time@empresa.com');
        expect(next.autoProvisioned).toBe(true);
        expect(next.mode).toBe('workspace_managed');
    });

    it('drops an explicitly linked account so going back to automatic creates a fresh one', () => {
        const current = normalizeNexusSettings({
            mode: 'existing_account',
            email: 'pessoa@empresa.com',
            username: 'pessoa',
            nexusUserId: 'user-1',
        });

        const next = buildWorkspaceManagedSettings('workspace-1', current);

        expect(next.email).not.toBe('pessoa@empresa.com');
        expect(next.email).toMatch(/^ws_workspace1_[0-9a-f]{12}@/);
        expect(next.nexusUserId).toBeUndefined();
    });

    it('preserves createdAt while refreshing updatedAt', () => {
        const current = normalizeNexusSettings({
            email: 'time@empresa.com',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
        });

        const next = buildWorkspaceManagedSettings('workspace-1', current);

        expect(next.createdAt).toBe('2020-01-01T00:00:00.000Z');
        expect(next.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });
});
