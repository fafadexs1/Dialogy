import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),decrypt:vi.fn(),encrypt:vi.fn(),request:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{connect:async()=>({query:mocks.query,release:mocks.release})}}));
vi.mock('@/modules/nexus/services/credentials',()=>({decryptPayload:mocks.decrypt,encryptPayload:mocks.encrypt}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.request}));
import {resolveNexusOAuthToken} from '@/modules/nexus/services/oauth-credentials';
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockImplementation(async(sql:string)=>sql.startsWith('SELECT')?{rows:[{encrypted_payload:'encrypted'}]}:{rows:[]});mocks.decrypt.mockReturnValue({provider:'notion',tokenUrl:'https://api.notion.com/v1/oauth/token',allowedOrigin:'https://api.notion.com',clientId:'id',clientSecret:'secret',grantType:'refresh_token',refreshToken:'old',expiresAt:0});mocks.request.mockResolvedValue({body:Buffer.from('{"access_token":"new","refresh_token":"rotated","token_type":"bearer"}')});mocks.encrypt.mockReturnValue('sealed');});
describe('Notion OAuth token renewal',()=>{
 it('rotates tokens with Basic authentication inside the locked workspace credential',async()=>{expect(await resolveNexusOAuthToken('ws','credential','https://api.notion.com',AbortSignal.timeout(5000))).toBe('new');expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({url:'https://api.notion.com/v1/oauth/token',headers:expect.objectContaining({Authorization:`Basic ${Buffer.from('id:secret').toString('base64')}`}),body:JSON.stringify({grant_type:'refresh_token',refresh_token:'old'})}));expect(mocks.encrypt).toHaveBeenCalledWith(expect.objectContaining({accessToken:'new',refreshToken:'rotated'}));expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE nexus_credentials'),['ws','credential','sealed']);});
 it('rejects token exfiltration to any other origin before refreshing',async()=>{await expect(resolveNexusOAuthToken('ws','credential','https://attacker.example',AbortSignal.timeout(5000))).rejects.toThrow('origem');expect(mocks.request).not.toHaveBeenCalled();});
});
