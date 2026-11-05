import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),query:vi.fn(),permission:vi.fn(),diagnostics:vi.fn(),availability:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user}})}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:mocks.permission}));
vi.mock('@/services/chat-distribution/diagnostics',()=>({distributionDiagnostics:mocks.diagnostics}));
vi.mock('@/services/chat-distribution/team-availability-server',()=>({getWorkspaceTeamAvailability:mocks.availability}));
import {getDistributionDiagnosticsAction} from '@/actions/distribution-diagnostics';
beforeEach(()=>{vi.resetAllMocks();mocks.user.mockResolvedValue({data:{user:{id:'operator'}}});mocks.query.mockResolvedValue({rows:[{workspace_id:'actual-workspace'}]});});
describe('distribution diagnostics authorization',()=>{
  it('requires authentication before reading a team',async()=>{
    mocks.user.mockResolvedValue({data:{user:null}});
    expect((await getDistributionDiagnosticsAction('team')).success).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('checks permissions against the team workspace and does not expose cross-workspace data',async()=>{
    mocks.permission.mockResolvedValue(false);
    expect((await getDistributionDiagnosticsAction('team')).success).toBe(false);
    expect(mocks.permission).toHaveBeenCalledWith('operator','actual-workspace','teams:view');
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });
  it('reads scoped diagnostics only after permission confirmation',async()=>{
    mocks.permission.mockResolvedValue(true);mocks.diagnostics.mockResolvedValue({members:[]});mocks.availability.mockResolvedValue([{teamId:'team',isWithinBusinessHours:false}]);
    expect(await getDistributionDiagnosticsAction('team')).toMatchObject({success:true,availability:{isWithinBusinessHours:false}});
    expect(mocks.diagnostics).toHaveBeenCalledWith(expect.anything(),'actual-workspace','team');
  });
});
