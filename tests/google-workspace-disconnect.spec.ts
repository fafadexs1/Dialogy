import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ user:vi.fn(), permission:vi.fn(), summaries:vi.fn(), credential:vi.fn(), remove:vi.fn(), revoke:vi.fn() }));
vi.mock('@/actions/user',()=>({getCurrentUser:mocks.user}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:mocks.permission}));
vi.mock('@/modules/nexus/services/credentials',()=>({listNexusCredentialSummaries:mocks.summaries,loadNexusCredentialPayload:mocks.credential,deleteNexusCredential:mocks.remove}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.revoke}));
vi.mock('@/services/mcp/store',()=>({getMcpWorkspaceConfig:vi.fn()}));
import { disconnectGoogleApp, disconnectOAuthApp } from '@/actions/ai-apps';
beforeEach(()=>{vi.resetAllMocks();mocks.user.mockResolvedValue({id:'user',activeWorkspaceId:'ws'});mocks.permission.mockResolvedValue(true);mocks.summaries.mockResolvedValue([{id:'credential',metadata:{provider:'google_workspace'}}]);mocks.credential.mockResolvedValue({payload:{refreshToken:'secret'}});mocks.revoke.mockResolvedValue({status:200});});
describe('Google disconnection',()=>{
 it('revokes at Google before deleting the workspace credential',async()=>{
  expect(await disconnectGoogleApp('ws','credential')).toEqual({success:true});
  expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({url:'https://oauth2.googleapis.com/revoke',method:'POST'}));
  expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  expect(mocks.remove).toHaveBeenCalledWith('ws','credential');
 });
 it('does not delete the credential if the provider revocation fails',async()=>{
  mocks.revoke.mockRejectedValue(new Error('provider unavailable'));
  expect((await disconnectGoogleApp('ws','credential')).success).toBe(false);expect(mocks.remove).not.toHaveBeenCalled();
 });
 it('does not access another workspace',async()=>{
  expect((await disconnectGoogleApp('other','credential')).success).toBe(false);expect(mocks.credential).not.toHaveBeenCalled();
 });
});

describe('GitHub and Notion disconnection',()=>{
 it.each(['github','notion'])('%s revokes the provider grant before deleting it',async(provider)=>{
  mocks.summaries.mockResolvedValue([{id:'credential',metadata:{provider}}]);
  mocks.credential.mockResolvedValue({payload:provider==='github'?{token:'token',clientId:'Iv1.abc',clientSecret:'secret'}:{accessToken:'token',clientId:'id',clientSecret:'secret'}});
  expect(await disconnectOAuthApp('ws','credential')).toEqual({success:true});
  expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({url:provider==='github'?'https://api.github.com/applications/Iv1.abc/grant':'https://api.notion.com/v1/oauth/revoke',method:provider==='github'?'DELETE':'POST'}));
  expect(JSON.parse(mocks.revoke.mock.calls[0][0].body)).toEqual(provider==='github'?{access_token:'token'}:{token:'token'});
  expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
 });
 it('retains the credential if revocation cannot be confirmed',async()=>{
  mocks.summaries.mockResolvedValue([{id:'credential',metadata:{provider:'github'}}]);mocks.credential.mockResolvedValue({payload:{token:'token',clientId:'id',clientSecret:'secret'}});mocks.revoke.mockRejectedValue(new Error('unavailable'));
  expect((await disconnectOAuthApp('ws','credential')).success).toBe(false);expect(mocks.remove).not.toHaveBeenCalled();
 });
});
