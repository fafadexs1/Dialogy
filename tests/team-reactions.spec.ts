import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),permission:vi.fn(),query:vi.fn(),broadcast:vi.fn(),rate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user}})}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:mocks.permission}));
vi.mock('@/lib/realtime/broadcast',()=>({broadcastRealtimeEvent:mocks.broadcast}));
vi.mock('@/lib/team-reactions/delivery-guard',()=>({reserveReactionDelivery:vi.fn(async()=>true),releaseReactionDelivery:vi.fn(async()=>undefined),renewReactionDelivery:vi.fn(async()=>true)}));
vi.mock('@/lib/ratelimit',()=>({consumeRateLimit:mocks.rate}));
import {sendTeamReaction} from '@/actions/team-reactions';
import {reserveReactionDelivery,releaseReactionDelivery} from '@/lib/team-reactions/delivery-guard';
const workspaceId='10000000-0000-4000-8000-000000000001', sender='20000000-0000-4000-8000-000000000001',targetId='20000000-0000-4000-8000-000000000002';
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:{id:sender}}});mocks.permission.mockResolvedValue(true);mocks.rate.mockReturnValue({ok:true});mocks.query.mockResolvedValue({rows:[{sender_name:'Maria',reactions_enabled:true}]});mocks.broadcast.mockResolvedValue('http');});
describe('team reactions',()=>{
 it('sends a validated effect to the recipient private channel',async()=>{expect(await sendTeamReaction({workspaceId,targetId,kind:'pum'})).toEqual({success:true});expect(mocks.broadcast).toHaveBeenCalledWith(`private:team-reaction:${targetId}`,'team_reaction',expect.objectContaining({kind:'pum',senderName:'Maria',workspaceId}));});
 it('rejects invalid effects and users without workspace access',async()=>{expect((await sendTeamReaction({workspaceId,targetId,kind:'not-a-reaction'})).success).toBe(false);mocks.permission.mockResolvedValue(false);expect((await sendTeamReaction({workspaceId,targetId,kind:'pum'})).success).toBe(false);expect(mocks.broadcast).not.toHaveBeenCalled();});
 it('allows a person to test a reaction on their own screen',async()=>{expect((await sendTeamReaction({workspaceId,targetId:sender,kind:'pum'})).success).toBe(true);});
 it('reports busy and does not broadcast a second reaction',async()=>{vi.mocked(reserveReactionDelivery).mockResolvedValueOnce(false);expect(await sendTeamReaction({workspaceId,targetId,kind:'pum'})).toMatchObject({success:false,error:expect.stringContaining('já está vendo')});expect(mocks.broadcast).not.toHaveBeenCalled();});
 it('releases a reservation if broadcasting fails',async()=>{mocks.broadcast.mockResolvedValue('failed');expect((await sendTeamReaction({workspaceId,targetId,kind:'pum'})).success).toBe(false);expect(releaseReactionDelivery).toHaveBeenCalledWith(targetId,expect.any(String));});
 it('does not send to someone unavailable or outside the workspace',async()=>{mocks.query.mockResolvedValue({rows:[]});expect((await sendTeamReaction({workspaceId,targetId,kind:'coffee'})).success).toBe(false);expect(mocks.broadcast).not.toHaveBeenCalled();});
 it('limits repeated sends and reports realtime failure',async()=>{mocks.rate.mockReturnValue({ok:false});expect((await sendTeamReaction({workspaceId,targetId,kind:'party'})).success).toBe(false);mocks.rate.mockReturnValue({ok:true});mocks.broadcast.mockResolvedValue('failed');expect((await sendTeamReaction({workspaceId,targetId,kind:'party'})).success).toBe(false);});
 it.each([false,null,undefined])('never reserves or broadcasts when the recipient did not opt in (%s)',async(enabled)=>{
   mocks.query.mockResolvedValue({rows:[{sender_name:'Maria',reactions_enabled:enabled}]});
   expect(await sendTeamReaction({workspaceId,targetId,kind:'party'})).toMatchObject({success:false,error:expect.stringContaining('desativou')});
   expect(reserveReactionDelivery).not.toHaveBeenCalled();expect(mocks.broadcast).not.toHaveBeenCalled();
 });

});
