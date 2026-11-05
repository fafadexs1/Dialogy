import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({user:vi.fn(),permission:vi.fn(),save:vi.fn(),request:vi.fn()}));
vi.mock('@/actions/user',()=>({getCurrentUser:mocks.user}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:mocks.permission}));
vi.mock('@/modules/nexus/services/credentials',()=>({saveNexusCredential:mocks.save}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.request}));
import {GET as start} from '@/app/api/integrations/app-oauth/[provider]/auth/route';
import {GET as callback} from '@/app/api/integrations/app-oauth/[provider]/callback/route';
const context=(provider:string)=>({params:Promise.resolve({provider})});
beforeEach(()=>{vi.resetAllMocks();process.env.NEXTAUTH_URL='https://dialogy.example';process.env.GITHUB_APPS_CLIENT_ID='github-id';process.env.GITHUB_APPS_CLIENT_SECRET='github-secret';process.env.NOTION_CLIENT_ID='notion-id';process.env.NOTION_CLIENT_SECRET='notion-secret';mocks.user.mockResolvedValue({id:'user',activeWorkspaceId:'ws'});mocks.permission.mockResolvedValue(true);});
async function launch(provider:string,access='read'){const result=await start(new NextRequest(`https://dialogy.example/api/integrations/app-oauth/${provider}/auth?access=${access}`),context(provider));const url=new URL(result.headers.get('location')!);const cookie=result.cookies.get(`dialogy_${provider}_oauth`)!.value;return {url,cookie,parsed:JSON.parse(Buffer.from(cookie,'base64url').toString('utf8'))};}
function finish(provider:string,state:string,cookie:string){return callback(new NextRequest(`https://dialogy.example/api/integrations/app-oauth/${provider}/callback?state=${encodeURIComponent(state)}&code=code`,{headers:{cookie:`dialogy_${provider}_oauth=${cookie}`}}),context(provider));}
describe('GitHub and Notion authorization',()=>{
 it('binds GitHub consent to browser state and PKCE and discloses the repo scope',async()=>{const {url,parsed}=await launch('github');expect(url.origin).toBe('https://github.com');expect(url.searchParams.get('scope')).toBe('repo');expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(parsed.verifier).digest('base64url'));});
 it('uses the documented Notion consent flow and binds the returned state to the browser',async()=>{const a=await launch('notion'),b=await launch('notion');expect(a.url.searchParams.get('owner')).toBe('user');const result=await finish('notion',a.url.searchParams.get('state')!,b.cookie);expect(result.headers.get('location')).toContain('invalido');expect(mocks.request).not.toHaveBeenCalled();});
 it.each(['github','notion'])('%s stores a workspace-scoped credential and fixed origin',async(provider)=>{const {url,cookie}=await launch(provider);mocks.request.mockResolvedValue({body:Buffer.from(JSON.stringify(provider==='github'?{access_token:'access',scope:'repo'}:{access_token:'access',refresh_token:'refresh'}))});const result=await finish(provider,url.searchParams.get('state')!,cookie);expect(result.headers.get('location')).toContain('conectado');expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'ws',metadata:expect.objectContaining({provider,access:'read',allowedOrigin:`https://api.${provider}.com`})}));});
 it('rejects partial GitHub grants and changes to the active workspace',async()=>{let a=await launch('github');mocks.request.mockResolvedValue({body:Buffer.from('{"access_token":"token","scope":"user"}')});expect((await finish('github',a.url.searchParams.get('state')!,a.cookie)).headers.get('location')).toContain('token_invalido');expect(mocks.save).not.toHaveBeenCalled();a=await launch('notion');mocks.user.mockResolvedValue({id:'user',activeWorkspaceId:'another'});expect((await finish('notion',a.url.searchParams.get('state')!,a.cookie)).headers.get('location')).toContain('sem_permissao');});
});
