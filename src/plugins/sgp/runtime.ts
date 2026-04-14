import { getCurrentUser } from '@/actions/user';

import type { SGPGlobalConfig } from './types';
import { loadSGPConfigForUser } from './config';

type SGPContextError = {
    error: string;
};

type SGPActiveWorkspaceContext = {
    currentUser: any;
    workspaceId: string;
    global: Awaited<ReturnType<typeof loadSGPConfigForUser>>['global'];
    sgpUser: Awaited<ReturnType<typeof loadSGPConfigForUser>>['user'];
    isGlobalReady: boolean;
};

export async function getSGPActiveWorkspaceContext(): Promise<SGPActiveWorkspaceContext | SGPContextError> {
    const currentUser = await getCurrentUser();
    if (!currentUser || !currentUser.activeWorkspaceId) {
        return { error: 'Unauthorized' };
    }

    const workspaceId = currentUser.activeWorkspaceId;
    const { global, user: sgpUser, isGlobalReady } = await loadSGPConfigForUser(workspaceId, currentUser);

    return {
        currentUser,
        workspaceId,
        global,
        sgpUser,
        isGlobalReady,
    };
}

export function isSGPContextError(
    context: SGPActiveWorkspaceContext | SGPContextError
): context is SGPContextError {
    return 'error' in context;
}

export function createSGPJsonRequestInit(token: string, body: unknown): RequestInit {
    return {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${token}`,
        },
        body: JSON.stringify(body),
    };
}

export function withSGPApplicationCredentials(
    global: SGPGlobalConfig | null | undefined,
    body: Record<string, unknown>
): Record<string, unknown> {
    if (!global?.appId || !global?.appToken) {
        return body;
    }

    return {
        ...body,
        app: global.appId,
        token: global.appToken,
    };
}

export function extractPhoneFromWhatsappJid(value?: string | null): string {
    return String(value ?? '')
        .trim()
        .replace(/@.*$/, '');
}
