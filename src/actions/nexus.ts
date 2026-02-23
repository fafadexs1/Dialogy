'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { randomBytes, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

export type NexusLinkMode = 'workspace_managed' | 'existing_account';

type NexusSettings = {
    mode?: NexusLinkMode;
    email?: string;
    username?: string;
    autoProvisioned?: boolean;
    nexusUserId?: string;
    createdAt?: string;
    updatedAt?: string;
};

type NexusConfigActionState = {
    success: boolean;
    error: string | null;
    config: NexusSettings | null;
};

type VerifiedNsxdUser = {
    id: string;
    email: string;
    username?: string;
    full_name?: string;
};

const FALLBACK_NEXUS_DOMAIN = 'nexus.dialogy.local';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const SSO_SOURCE = 'dialogy';

function buildWorkspaceIdentity(workspaceId: string) {
    const domain = (process.env.NEXUS_WORKSPACE_EMAIL_DOMAIN || FALLBACK_NEXUS_DOMAIN)
        .trim()
        .toLowerCase();
    const workspaceKey = workspaceId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12) || 'workspace';
    const randomSuffix = randomBytes(6).toString('hex');
    const username = `ws_${workspaceKey}_${randomSuffix}`;
    const email = `${username}@${domain}`;
    return { username, email };
}

function normalizeNexusSettings(raw: unknown): NexusSettings {
    const value = (raw && typeof raw === 'object') ? (raw as NexusSettings) : {};

    let mode: NexusLinkMode;
    if (value.mode === 'workspace_managed' || value.mode === 'existing_account') {
        mode = value.mode;
    } else if (value.email && !value.autoProvisioned) {
        mode = 'existing_account';
    } else {
        mode = 'workspace_managed';
    }

    return {
        mode,
        email: value.email,
        username: value.username,
        autoProvisioned: value.autoProvisioned,
        nexusUserId: value.nexusUserId,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

function buildWorkspaceManagedSettings(workspaceId: string, currentSettings: NexusSettings): NexusSettings {
    const now = new Date().toISOString();
    const isReusableAuto = !!(currentSettings.autoProvisioned && currentSettings.email);
    const generatedIdentity = isReusableAuto
        ? { email: currentSettings.email as string, username: currentSettings.username }
        : buildWorkspaceIdentity(workspaceId);

    return {
        mode: 'workspace_managed',
        email: generatedIdentity.email,
        username: generatedIdentity.username || currentSettings.username,
        autoProvisioned: true,
        nexusUserId: undefined,
        createdAt: currentSettings.createdAt || now,
        updatedAt: now,
    };
}

function buildExistingAccountSettings(verifiedUser: VerifiedNsxdUser, currentSettings: NexusSettings): NexusSettings {
    const now = new Date().toISOString();
    const normalizedEmail = verifiedUser.email.trim().toLowerCase();
    const normalizedUsername = (verifiedUser.username || normalizedEmail.split('@')[0]).trim();

    return {
        mode: 'existing_account',
        email: normalizedEmail,
        username: normalizedUsername,
        autoProvisioned: false,
        nexusUserId: verifiedUser.id,
        createdAt: currentSettings.createdAt || now,
        updatedAt: now,
    };
}

async function getAuthenticatedUserId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

async function loadWorkspaceNexusRow(client: any, workspaceId: string, userId: string, lockRow: boolean) {
    const lockClause = lockRow ? 'FOR UPDATE' : '';
    return client.query(
        `
            SELECT w.nexus_settings
            FROM workspaces w
            JOIN user_workspace_roles uwr ON uwr.workspace_id = w.id
            WHERE w.id = $1 AND uwr.user_id = $2
            ${lockClause}
        `,
        [workspaceId, userId]
    );
}

function getNexusServiceUrl() {
    return (
        process.env.NEXUS_URL ||
        process.env.NEXT_PUBLIC_NEXUS_URL ||
        process.env.NSXD_URL ||
        process.env.NEXT_PUBLIC_NSXD_URL ||
        ''
    ).trim();
}

function getSsoSecret() {
    return (process.env.DIALOGY_INTERNAL_SECRET || '').trim();
}

function buildSsoSignature(input: {
    email: string;
    workspaceId: string;
    mode: NexusLinkMode;
    issuedAt: number;
    nexusUserId?: string;
}) {
    const secret = getSsoSecret();
    if (!secret) {
        throw new Error('DIALOGY_INTERNAL_SECRET is not configured.');
    }
    const canonical = [
        input.email.trim().toLowerCase(),
        input.workspaceId,
        input.mode,
        String(input.issuedAt),
        input.nexusUserId || '',
    ].join('|');
    return createHmac('sha256', secret).update(canonical).digest('hex');
}

async function verifyExistingAccountInNsxd(
    email: string,
    password: string
): Promise<{ success: boolean; error?: string; user?: VerifiedNsxdUser }> {
    const nsxdUrl = getNexusServiceUrl();
    const secret = getSsoSecret();

    if (!nsxdUrl) {
        return { success: false, error: 'URL do NSXD/NexusFlow nao configurada no servidor.' };
    }
    if (!secret) {
        return { success: false, error: 'Segredo interno entre Dialogy e NSXD nao configurado.' };
    }

    try {
        const response = await fetch(`${nsxdUrl}/api/internal/sso/verify-account`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secret}`,
            },
            body: JSON.stringify({ email, password }),
            cache: 'no-store',
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                success: false,
                error: body?.error || body?.reason || 'Falha ao validar a conta existente no NexusFlow.',
            };
        }

        const user = body?.user as VerifiedNsxdUser | undefined;
        if (!user?.id || !user?.email) {
            return { success: false, error: 'Resposta invalida do validador de conta NexusFlow.' };
        }

        return { success: true, user };
    } catch (error) {
        console.error('[Nexus] verifyExistingAccountInNsxd failed:', error);
        return { success: false, error: 'Nao foi possivel validar a conta no NexusFlow agora.' };
    }
}

function encodeAuthPayload(data: unknown) {
    const jsonStr = JSON.stringify(data);
    const uriEncoded = encodeURIComponent(jsonStr);
    const base64 = Buffer.from(uriEncoded, 'utf8').toString('base64');
    return encodeURIComponent(base64);
}

export async function getNexusConfig(workspaceId: string): Promise<NexusSettings | null> {
    if (!workspaceId) {
        return null;
    }

    const userId = await getAuthenticatedUserId();
    if (!userId) {
        return null;
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const result = await loadWorkspaceNexusRow(client, workspaceId, userId, true);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const currentSettings = normalizeNexusSettings(result.rows[0].nexus_settings);
        const currentEmail = currentSettings.email?.trim();
        const isExistingMode = currentSettings.mode === 'existing_account';

        if (currentEmail && isExistingMode) {
            await client.query('COMMIT');
            return currentSettings;
        }

        if (currentEmail && currentSettings.autoProvisioned) {
            await client.query('COMMIT');
            return { ...currentSettings, mode: 'workspace_managed' };
        }

        const nextSettings = buildWorkspaceManagedSettings(workspaceId, currentSettings);

        await client.query(
            'UPDATE workspaces SET nexus_settings = $1::jsonb WHERE id = $2',
            [JSON.stringify(nextSettings), workspaceId]
        );

        await client.query('COMMIT');
        return nextSettings;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {
            // no-op rollback guard
        });
        console.error('Error fetching Nexus config:', error);
        return null;
    } finally {
        client.release();
    }
}

export async function saveNexusConfig(input: {
    workspaceId: string;
    mode: NexusLinkMode;
    existingEmail?: string;
    existingPassword?: string;
}): Promise<{ success: boolean; error?: string; config?: NexusSettings }> {
    const workspaceId = input.workspaceId?.trim();
    const mode = input.mode;
    const existingEmail = input.existingEmail?.trim();
    const existingPassword = input.existingPassword || '';

    if (!workspaceId) {
        return { success: false, error: 'Workspace invalido.' };
    }
    if (mode !== 'workspace_managed' && mode !== 'existing_account') {
        return { success: false, error: 'Modo de vinculacao invalido.' };
    }
    if (mode === 'existing_account' && (!existingEmail || !EMAIL_REGEX.test(existingEmail))) {
        return { success: false, error: 'Informe um e-mail valido da conta existente do NexusFlow.' };
    }
    if (mode === 'existing_account' && !existingPassword.trim()) {
        return { success: false, error: 'Informe a senha da conta existente para validar o vinculo.' };
    }

    const userId = await getAuthenticatedUserId();
    if (!userId) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const result = await loadWorkspaceNexusRow(client, workspaceId, userId, true);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Workspace nao encontrado ou sem permissao.' };
        }

        const currentSettings = normalizeNexusSettings(result.rows[0].nexus_settings);
        let nextSettings: NexusSettings;

        if (mode === 'existing_account') {
            const validation = await verifyExistingAccountInNsxd(existingEmail as string, existingPassword);
            if (!validation.success || !validation.user) {
                await client.query('ROLLBACK');
                return { success: false, error: validation.error || 'Nao foi possivel validar a conta existente.' };
            }
            nextSettings = buildExistingAccountSettings(validation.user, currentSettings);
        } else {
            nextSettings = buildWorkspaceManagedSettings(workspaceId, currentSettings);
        }

        await client.query(
            'UPDATE workspaces SET nexus_settings = $1::jsonb WHERE id = $2',
            [JSON.stringify(nextSettings), workspaceId]
        );

        await client.query('COMMIT');
        return { success: true, config: nextSettings };
    } catch (error: any) {
        await client.query('ROLLBACK').catch(() => {
            // no-op rollback guard
        });
        console.error('Error saving Nexus config:', error);
        return { success: false, error: 'Falha ao salvar configuracao do NexusFlow.' };
    } finally {
        client.release();
    }
}

export async function updateNexusConfigAction(
    _prevState: NexusConfigActionState,
    formData: FormData
): Promise<NexusConfigActionState> {
    const workspaceId = (formData.get('workspaceId') as string) || '';
    const mode = ((formData.get('mode') as string) || 'workspace_managed') as NexusLinkMode;
    const existingEmail = (formData.get('existingEmail') as string) || '';
    const existingPassword = (formData.get('existingPassword') as string) || '';

    const result = await saveNexusConfig({ workspaceId, mode, existingEmail, existingPassword });
    if (!result.success) {
        return {
            success: false,
            error: result.error || 'Falha ao atualizar a configuracao.',
            config: null,
        };
    }

    return {
        success: true,
        error: null,
        config: result.config || null,
    };
}

export async function createNexusAuthPayload(
    workspaceId: string
): Promise<{ success: boolean; error?: string; authPayload?: string; config?: NexusSettings }> {
    if (!workspaceId) {
        return { success: false, error: 'Workspace invalido para autenticar no NexusFlow.' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuario nao autenticado no Dialogy.' };
    }

    const config = await getNexusConfig(workspaceId);
    if (!config?.email) {
        return { success: false, error: 'Conta NexusFlow nao disponivel para o workspace.' };
    }

    try {
        const issuedAt = Math.floor(Date.now() / 1000);
        const mode = (config.mode === 'existing_account') ? 'existing_account' : 'workspace_managed';
        const nexusUserId = config.nexusUserId || '';

        const signature = buildSsoSignature({
            email: config.email,
            workspaceId,
            mode,
            issuedAt,
            nexusUserId,
        });

        const ssoUser = {
            id: user.id,
            email: config.email,
            username: config.username || config.email.split('@')[0],
            full_name: config.username || config.email.split('@')[0],
            workspace_id: workspaceId,
            nexus_link_mode: mode,
            require_existing_account: mode === 'existing_account',
            sso_source: SSO_SOURCE,
            sso_issued_at: issuedAt,
            sso_target_user_id: nexusUserId || undefined,
            sso_signature: signature,
        };

        const authPayload = encodeAuthPayload({
            user: ssoUser,
            session: { access_token: 'dialogy-sso-token' },
        });

        return { success: true, authPayload, config };
    } catch (error) {
        console.error('[Nexus] createNexusAuthPayload failed:', error);
        return { success: false, error: 'Falha ao assinar autenticacao para o NexusFlow.' };
    }
}

export async function getNexusUrl() {
    return getNexusServiceUrl() || "http://localhost:3000";
}
