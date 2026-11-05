import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ user:vi.fn(), permission:vi.fn(), save:vi.fn(), request:vi.fn() }));
vi.mock('@/actions/user', () => ({ getCurrentUser:mocks.user }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission:mocks.permission }));
vi.mock('@/modules/nexus/services/credentials', () => ({ saveNexusCredential:mocks.save }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps:mocks.request }));
import { GET as start } from '@/app/api/integrations/google-workspace/auth/route';
import { GET as callback } from '@/app/api/integrations/google-workspace/callback/route';
import { GOOGLE_APPS } from '@/services/ai-apps/google-oauth';
beforeEach(() => { vi.resetAllMocks(); process.env.GOOGLE_WORKSPACE_CLIENT_ID='client'; process.env.GOOGLE_WORKSPACE_CLIENT_SECRET='client-secret'; process.env.NEXTAUTH_URL='https://dialogy.example'; mocks.user.mockResolvedValue({id:'user',activeWorkspaceId:'ws'}); mocks.permission.mockResolvedValue(true); mocks.save.mockResolvedValue({id:'credential'}); });
async function launch(app='calendar', access='read') {
  const response=await start(new NextRequest(`https://dialogy.example/api/integrations/google-workspace/auth?app=${app}&access=${access}`));
  const url=new URL(response.headers.get('location')!); const cookie=response.cookies.get('dialogy_google_oauth')!.value;
  const parsed=JSON.parse(Buffer.from(cookie,'base64url').toString('utf8'));
  return {url,cookie,parsed};
}
function call(state:string,cookie:string,code='authorization-code') { return callback(new NextRequest(`https://dialogy.example/api/integrations/google-workspace/callback?state=${encodeURIComponent(state)}&code=${code}`,{headers:{cookie:`dialogy_google_oauth=${cookie}`}})); }
describe('Google workspace authorization',()=>{
 it('requests only the selected application scopes and binds state to an HttpOnly PKCE cookie',async()=>{
  const {url,cookie,parsed}=await launch('gmail','write');
  expect(url.origin).toBe('https://accounts.google.com'); expect(url.searchParams.get('scope')).toBe(GOOGLE_APPS.gmail.write.join(' '));
  expect(url.searchParams.get('state')).toBe(parsed.state); expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(parsed.verifier).digest('base64url'));
  expect(Buffer.from(cookie,'base64url').toString()).not.toContain('client-secret');
 });
 it('requests the separate Calendar availability scope together with event access',async()=>{
  for (const access of ['read','write'] as const) {const {url}=await launch('calendar',access);const scopes=url.searchParams.get('scope')!.split(' ');expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events.freebusy');expect(scopes).toContain(access==='read'?'https://www.googleapis.com/auth/calendar.events.readonly':'https://www.googleapis.com/auth/calendar.events');}
 });
 it('requests Google Tasks scopes for the chosen access mode',async()=>{
  const read=await launch('tasks','read'),write=await launch('tasks','write');
  expect(read.url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/tasks.readonly');
  expect(write.url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/tasks');
 });
 it.each(['docs','sheets','slides'] as const)('requests distinct %s read and write scopes and binds credentials to its API origin',async(app)=>{
  for(const access of ['read','write'] as const){
   const {url,cookie}=await launch(app,access);
   expect(url.searchParams.get('scope')).toBe(GOOGLE_APPS[app][access].join(' '));
   mocks.request.mockResolvedValueOnce({body:Buffer.from(JSON.stringify({refresh_token:'secret',scope:GOOGLE_APPS[app][access].join(' ')}))});
   expect((await call(url.searchParams.get('state')!,cookie)).headers.get('location')).toContain('conectado');
   expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({payload:expect.objectContaining({allowedOrigin:GOOGLE_APPS[app].origin}),metadata:expect.objectContaining({app,access})}));
  }
 });
 it('exchanges a valid browser-bound code and saves encrypted workspace credential metadata',async()=>{
  const {url,cookie,parsed}=await launch(); mocks.request.mockResolvedValue({body:Buffer.from(JSON.stringify({refresh_token:'refresh-secret',scope:GOOGLE_APPS.calendar.read.join(' ')}))});
  const response=await call(url.searchParams.get('state')!,cookie);
  expect(response.headers.get('location')).toContain('google=conectado');
  expect(mocks.request.mock.calls[0][0].body).toContain(`code_verifier=${parsed.verifier}`);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'ws',userId:'user',type:'oauth2',metadata:expect.objectContaining({app:'calendar',access:'read',provider:'google_workspace'})}));
  expect(response.cookies.get('dialogy_google_oauth')?.value).toBe('');
 });
 it('rejects substituted or expired browser state before exchanging a token',async()=>{
  const one=await launch(), two=await launch();
  const result=await call(one.url.searchParams.get('state')!,two.cookie);
  expect(result.headers.get('location')).toContain('google=invalido');expect(mocks.request).not.toHaveBeenCalled();
 });
 it('rechecks the user and workspace permission at callback',async()=>{
  const {url,cookie}=await launch(); mocks.user.mockResolvedValue({id:'other',activeWorkspaceId:'ws'});
  const result=await call(url.searchParams.get('state')!,cookie);expect(result.headers.get('location')).toContain('google=sem_permissao');expect(mocks.request).not.toHaveBeenCalled();
 });
 it('does not save a credential if Google declines a requested scope',async()=>{
  const {url,cookie}=await launch('gmail','write'); mocks.request.mockResolvedValue({body:Buffer.from(JSON.stringify({refresh_token:'secret',scope:GOOGLE_APPS.gmail.read.join(' ')}))});
  const result=await call(url.searchParams.get('state')!,cookie);expect(result.headers.get('location')).toContain('google=escopo_ou_token_ausente');expect(mocks.save).not.toHaveBeenCalled();
 });
});
