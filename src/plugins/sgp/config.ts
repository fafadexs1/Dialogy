import { getCustomFieldDefinitions as fetchCustomFields } from '@/actions/crm';
import { saveIntegrationConfig, getIntegrationConfig } from '@/actions/integrations';
import { getCurrentUser } from '@/actions/user';

import type { SGPGlobalConfig, SGPUserConfig } from './types';

function hasAdminAccess(user: any, workspaceId: string): boolean {
    const currentWorkspace = user.workspaces?.find((workspace: { id: string }) => workspace.id === workspaceId);

    return Boolean(
        currentWorkspace?.isOwner ||
        currentWorkspace?.roleName === 'Owner' ||
        currentWorkspace?.roleName === 'Admin' ||
        currentWorkspace?.roleName === 'Administrador' ||
        user.is_superadmin
    );
}

export async function loadSGPConfigForUser(workspaceId: string, user: any) {
    const { config: globalConfig } = await getIntegrationConfig(workspaceId, 'sgp');
    const { config: userConfigRaw } = await getIntegrationConfig(workspaceId, `sgp_user_${user.id}`);

    return {
        global: globalConfig as SGPGlobalConfig | null,
        user: userConfigRaw as SGPUserConfig | null,
        isGlobalReady: Boolean(globalConfig?.baseUrl && globalConfig?.cpfFieldId),
        isAdmin: hasAdminAccess(user, workspaceId),
    };
}

export async function saveSGPGlobalConfigImpl(
    workspaceId: string,
    data: {
        baseUrl: string;
        cpfFieldId: string;
        appId: string;
        appToken: string;
        teamSectors: Record<string, string>;
    }
) {
    const user = await getCurrentUser();

    if (!user) {
        return { success: false, error: 'Unauthorized' };
    }

    if (!hasAdminAccess(user, workspaceId)) {
        return { success: false, error: 'Acesso negado: Apenas administradores podem alterar configuracoes globais.' };
    }

    const config = {
        baseUrl: data.baseUrl,
        cpfFieldId: data.cpfFieldId,
        appId: data.appId,
        appToken: data.appToken,
        teamSectors: data.teamSectors,
    };

    return saveIntegrationConfig(workspaceId, 'sgp', config, true);
}

export async function saveSGPUserConfigImpl(
    workspaceId: string,
    data: { username: string; password?: string }
) {
    const user = await getCurrentUser();
    if (!user) {
        return { success: false, error: 'Unauthorized' };
    }

    if (!data.username || !data.password) {
        return { success: false, error: 'Missing credentials' };
    }

    const token = Buffer.from(`${data.username}:${data.password}`).toString('base64');

    return saveIntegrationConfig(
        workspaceId,
        `sgp_user_${user.id}`,
        {
            username: data.username,
            token,
        },
        true
    );
}

export async function getSGPConfigImpl(workspaceId: string) {
    const user = await getCurrentUser();
    if (!user) {
        return { global: null, user: null, isGlobalReady: false, isAdmin: false };
    }

    return loadSGPConfigForUser(workspaceId, user);
}

export async function getCRMFieldsImpl(workspaceId: string) {
    return fetchCustomFields(workspaceId);
}
