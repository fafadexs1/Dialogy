import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),user:vi.fn(),access:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query,connect:mocks.connect}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user}})}));
vi.mock('@/lib/security/access',()=>({requireWorkspaceAccess:mocks.access}));
import {savePersonalInactivitySettings} from '@/actions/agent-inactivity';
import {saveWhatsappReferenceRates} from '@/actions/whatsapp-reference-rates';
beforeEach(()=>{vi.resetAllMocks();mocks.user.mockResolvedValue({data:{user:{id:'user'}}});mocks.access.mockResolvedValue({});});
describe('settings authorization',()=>{
 it('saves only for the signed-in user and active workspace',async()=>{mocks.query.mockResolvedValueOnce({rows:[{last_active_workspace_id:'workspace'}]}).mockResolvedValueOnce({rows:[]});await savePersonalInactivitySettings({minutes:30,message:'Até logo'});expect(mocks.access).toHaveBeenCalledWith('workspace');expect(mocks.query.mock.calls[1][1]).toEqual(['workspace','user',30,'Até logo']);});
 it('rejects invalid timeout and workspace access',async()=>{mocks.query.mockResolvedValue({rows:[{last_active_workspace_id:'workspace'}]});await expect(savePersonalInactivitySettings({minutes:-1,message:''})).rejects.toThrow();mocks.access.mockRejectedValue(new Error('Sem acesso'));await expect(savePersonalInactivitySettings({minutes:5,message:''})).rejects.toThrow();expect(mocks.query).toHaveBeenCalledTimes(2);});
 it('blocks rate edits for non-superadmins',async()=>{mocks.query.mockResolvedValue({rows:[{is_superadmin:false}]});await expect(saveWhatsappReferenceRates({currency:'USD',rates:{UTILITY:0.1}})).rejects.toThrow();expect(mocks.connect).not.toHaveBeenCalled();});
 it('rejects negative rates before writing',async()=>{mocks.query.mockResolvedValue({rows:[{is_superadmin:true}]});await expect(saveWhatsappReferenceRates({currency:'USD',rates:{UTILITY:-1}})).rejects.toThrow();expect(mocks.connect).not.toHaveBeenCalled();});
});
