import { randomBytes } from 'node:crypto';

export type NexusLinkMode = 'workspace_managed' | 'existing_account';

export type NexusSettings = {
    mode?: NexusLinkMode;
    email?: string;
    username?: string;
    autoProvisioned?: boolean;
    nexusUserId?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type VerifiedNsxdUser = {
    id: string;
    email: string;
    username?: string;
    full_name?: string;
};

const FALLBACK_NEXUS_DOMAIN = 'nexus.dialogy.local';

export function buildWorkspaceIdentity(workspaceId: string) {
    const domain = (process.env.NEXUS_WORKSPACE_EMAIL_DOMAIN || FALLBACK_NEXUS_DOMAIN)
        .trim()
        .toLowerCase();
    const workspaceKey = workspaceId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12) || 'workspace';
    const randomSuffix = randomBytes(6).toString('hex');
    const username = `ws_${workspaceKey}_${randomSuffix}`;
    const email = `${username}@${domain}`;
    return { username, email };
}

export function normalizeNexusSettings(raw: unknown): NexusSettings {
    const value = (raw && typeof raw === 'object') ? (raw as NexusSettings) : {};

    // So conta como vinculo a conta existente quando ele foi feito de forma
    // explicita pela tela de integracao, que valida e-mail + senha. Linhas
    // legadas gravadas pelo formulario antigo do workspace tinham apenas
    // { email } e eram lidas como vinculo -- o SSO entao exigia uma conta que
    // nunca existiu no NexusFlow e o iframe caia na tela de login.
    const mode: NexusLinkMode = value.mode === 'existing_account'
        ? 'existing_account'
        : 'workspace_managed';

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

export function buildWorkspaceManagedSettings(workspaceId: string, currentSettings: NexusSettings): NexusSettings {
    const now = new Date().toISOString();
    // Reaproveita a identidade que o workspace ja usava, inclusive as linhas
    // legadas sem `autoProvisioned` -- trocar o e-mail aqui significaria abrir
    // uma conta nova no NexusFlow e abandonar todos os fluxos ja criados.
    // So um vinculo explicito a uma conta existente e descartado, para que
    // voltar ao modo automatico realmente gere uma conta tecnica limpa.
    const reusableEmail = currentSettings.mode === 'existing_account'
        ? undefined
        : currentSettings.email?.trim();
    const generatedIdentity = reusableEmail
        ? { email: reusableEmail, username: currentSettings.username }
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

export function buildExistingAccountSettings(
    verifiedUser: VerifiedNsxdUser,
    currentSettings: NexusSettings
): NexusSettings {
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
