import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),query:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock('@/lib/db',()=>({db:{query:m.query}}));
import {getReactionSoundPreference,saveReactionSoundPreference,getTeamReactionPreference,saveTeamReactionPreference} from '@/actions/reaction-sound-preference';
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:'user-1'}}});m.query.mockResolvedValue({rows:[]});});
describe('personal reaction sound preference',()=>{
 it('defaults to sound muted and reads the logged-in account preference',async()=>{expect(await getReactionSoundPreference()).toEqual({muted:true});expect(m.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id=$1'),['user-1']);});
 it('saves only the authenticated account and rejects invalid values',async()=>{expect(await saveReactionSoundPreference(true)).toEqual({muted:true});expect(m.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(user_id)'),['user-1',true]);await expect(saveReactionSoundPreference('true')).rejects.toThrow();});
 it('requires authentication',async()=>{m.user.mockResolvedValue({data:{user:null}});await expect(saveReactionSoundPreference(true)).rejects.toThrow();expect(m.query).not.toHaveBeenCalled();});
 it('requires explicit opt-in even for an existing sound preference',async()=>{
   expect(await getTeamReactionPreference()).toEqual({userId:'user-1',enabled:false,muted:true});
   m.query.mockResolvedValue({rows:[{muted:false}]});
   expect(await getTeamReactionPreference()).toEqual({userId:'user-1',enabled:false,muted:false});
 });
 it('can enable and disable only the logged-in account without overwriting its sound choice',async()=>{
   m.query.mockResolvedValue({rows:[{muted:false}]});
   expect(await saveTeamReactionPreference(true)).toEqual({userId:'user-1',enabled:true,muted:false});
   expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining('enabled=EXCLUDED.enabled'),['user-1',true]);
   expect(await saveTeamReactionPreference(false)).toMatchObject({enabled:false});
   expect(m.query).toHaveBeenLastCalledWith(expect.any(String),['user-1',false]);
   await expect(saveTeamReactionPreference('true')).rejects.toThrow();
 });

});
