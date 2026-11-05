import { beforeEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),user:vi.fn(),permission:vi.fn(),transfer:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:m.query}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:m.permission}));
vi.mock('@/actions/chats',()=>({transferChatAction:m.transfer}));
import {transferChatsBulkAction} from '@/actions/bulk-transfer';
const workspaceId='10000000-0000-4000-8000-000000000001',a='20000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',other='20000000-0000-4000-8000-000000000003',agent='30000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.resetAllMocks();m.user.mockResolvedValue({data:{user:{id:'u'}}});m.permission.mockResolvedValue(true);m.query.mockResolvedValue({rows:[{id:a},{id:b}]});m.transfer.mockImplementation(async({chatId})=>chatId===a?{success:true}:{success:false,error:'Destino indisponível'});});
describe('bulk transfers',()=>{
 it('transfers only workspace conversations and reports partial failures',async()=>{const r=await transferChatsBulkAction({workspaceId,chatIds:[a,b,other,a],destination:{type:'agent',id:agent}});expect(r.success).toBe(true);if(r.success){expect(r.transferred).toEqual([a]);expect(r.failed.map(x=>x.id)).toEqual([b,other]);}expect(m.transfer).toHaveBeenCalledTimes(2);});
 it('denies callers without the inbox and transfer permissions',async()=>{m.permission.mockResolvedValue(false);const r=await transferChatsBulkAction({workspaceId,chatIds:[a],destination:{type:'agent',id:agent}});expect(r.success).toBe(false);expect(m.transfer).not.toHaveBeenCalled();});
 it('rejects invalid or excessive requests before transfer',async()=>{const r=await transferChatsBulkAction({workspaceId,chatIds:Array(101).fill(a),destination:{type:'agent',id:agent}});expect(r.success).toBe(false);expect(m.transfer).not.toHaveBeenCalled();});
});
