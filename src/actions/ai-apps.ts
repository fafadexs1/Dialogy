'use server';

import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { listNexusCredentialSummaries, loadNexusCredentialPayload, deleteNexusCredential } from '@/modules/nexus/services/credentials';
import { requestPublicHttps } from '@/modules/nexus/services/public-http';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import { db } from '@/lib/db';

/** Only public operational summaries leave the server; connection credentials never do. */
export async function listAiAppConnections(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
    return { success: false as const, error: 'É necessária permissão para administrar as integrações deste workspace.', servers: [] };
  }
  try {
    const [config, credentials] = await Promise.all([getMcpWorkspaceConfig(workspaceId).catch(() => null), listNexusCredentialSummaries(workspaceId)]);
    const google = credentials.filter(credential => credential.metadata.provider === 'google_workspace').map(credential => ({ id: credential.id, name: credential.name, app: String(credential.metadata.app || ''), access: String(credential.metadata.access || '') }));
    const connectedApps = credentials.filter(credential => ['github', 'notion'].includes(String(credential.metadata.provider))).map(credential => ({ id: credential.id, name: credential.name, app: String(credential.metadata.provider), access: String(credential.metadata.access || '') }));
    return { success: true as const, google, connectedApps, serverError: config ? '' : 'Não foi possível carregar os servidores MCP.', servers: (config?.servers || []).map((server) => ({
      id: server.id, name: server.name, isActive: server.isActive,
      toolCount: server.tools?.length || 0, syncedAt: server.syncedAt || null,
      healthStatus: server.healthStatus || 'unknown',
    })) };
  } catch {
    return { success: false as const, error: 'Não foi possível carregar as conexões. Tente novamente.', servers: [] };
  }
}

/** Destructive action is limited to the active workspace and requires its administrator. */
export async function clearAiAppMemory(workspaceId: string, contactId?: string) {
  const user = await getCurrentUser();
  if (!user || user.activeWorkspaceId !== workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
    return { success: false as const, error: 'É necessária permissão para administrar as integrações deste workspace.' };
  }
  const contact = contactId?.trim() || null;
  if (contact && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contact)) {
    return { success: false as const, error: 'Informe um ID de contato válido.' };
  }
  try {
    const result = await db.query(`WITH reset AS (
        INSERT INTO public.studio_tool_memory_resets(workspace_id,scope_key,cleared_at)
        VALUES($1,CASE WHEN $2::uuid IS NULL THEN 'workspace' ELSE 'contact:' || $2::text END,clock_timestamp())
        ON CONFLICT(workspace_id,scope_key) DO UPDATE SET cleared_at=EXCLUDED.cleared_at, generation=gen_random_uuid() RETURNING cleared_at
      ), removed AS (
        DELETE FROM public.studio_tool_memory WHERE workspace_id=$1 AND ($2::uuid IS NULL OR contact_id=$2::uuid) AND EXISTS(SELECT 1 FROM reset) RETURNING 1
      ) SELECT count(*)::integer AS deleted FROM removed`, [workspaceId, contact]);
    return { success: true as const, deleted: Number(result.rows[0]?.deleted || 0) };
  } catch {
    return { success: false as const, error: 'Não foi possível limpar a memória. Verifique a migração e tente novamente.' };
  }
}

/** Google revocation can also invalidate grants for the same account/project. */
export async function disconnectGoogleApp(workspaceId: string, credentialId: string) {
  const user = await getCurrentUser();
  if (!user || user.activeWorkspaceId !== workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) return { success: false as const, error: 'Acesso não autorizado.' };
  try {
    const connection = (await listNexusCredentialSummaries(workspaceId)).find(item => item.id === credentialId && item.metadata.provider === 'google_workspace');
    if (!connection) throw new Error('Conexão não encontrada.');
    const credential = await loadNexusCredentialPayload({ workspaceId, credentialId, allowedTypes: ['oauth2'] });
    const token = credential.payload.refreshToken;
    if (typeof token !== 'string' || !token) throw new Error('Credencial sem token de renovação.');
    await requestPublicHttps({ url: 'https://oauth2.googleapis.com/revoke', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), timeoutMs: 15000, maxResponseBytes: 16000, signal: AbortSignal.timeout(15000) });
    await deleteNexusCredential(workspaceId, credentialId);
    return { success: true as const };
  } catch { return { success: false as const, error: 'Não foi possível revogar a conexão no Google. Tente novamente ou revogue-a na sua Conta Google.' }; }
}

export async function disconnectOAuthApp(workspaceId: string, credentialId: string) {
  const user = await getCurrentUser();
  if (!user || user.activeWorkspaceId !== workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) return { success: false as const, error: 'Acesso não autorizado.' };
  try {
    const connection = (await listNexusCredentialSummaries(workspaceId)).find(item => item.id === credentialId && ['github', 'notion'].includes(String(item.metadata.provider)));
    if (!connection) throw new Error('Conexão indisponível.');
    const github = connection.metadata.provider === 'github';
    const credential = await loadNexusCredentialPayload({ workspaceId, credentialId, allowedTypes: [github ? 'bearer' : 'oauth2'] });
    const { clientId, clientSecret } = credential.payload;
    const token = github ? credential.payload.token : credential.payload.accessToken;
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(clientId) || typeof clientSecret !== 'string' || !clientSecret || typeof token !== 'string' || !token) throw new Error('Credencial incompleta.');
    const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    await requestPublicHttps({ url: github ? `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant` : 'https://api.notion.com/v1/oauth/revoke', method: github ? 'DELETE' : 'POST', headers: { Authorization: authorization, 'Content-Type':'application/json', ...(github ? { Accept:'application/vnd.github+json', 'User-Agent':'DialogyAgent/1.0', 'X-GitHub-Api-Version':'2022-11-28' } : { 'Notion-Version':'2025-09-03' }) }, body: JSON.stringify(github ? { access_token:token } : { token }), timeoutMs:15000, maxResponseBytes:16000, signal:AbortSignal.timeout(15000) });
    await deleteNexusCredential(workspaceId,credentialId);
    return {success:true as const};
  } catch { return {success:false as const,error:'Não foi possível revogar a conexão no serviço. Tente novamente ou revogue o acesso na conta do provedor.'}; }
}
