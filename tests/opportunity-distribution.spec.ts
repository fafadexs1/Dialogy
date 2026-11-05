import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideOpportunity, distributionMode, type OpportunityCandidate } from '@/services/chat-distribution/policy';

const now = new Date('2026-10-28T12:00:00Z');
const candidate = (agentId: string, overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate => ({
  agentId,agentName:agentId,teamId:'team',teamName:'Comercial',capacity:6,maxPortfolio:25,
  portfolioCount:0,effectiveLoad:0,fairnessScore:null,lastAssignedAt:null,onlineSince:null,balance:0,...overrides,
});
function simulate(capacities: number[], rounds: number) {
  let agents = capacities.map((capacity,i) => candidate(String(i),{capacity}));
  const counts = capacities.map(() => 0);
  for (let step=0;step<rounds;step++) {
    const decision=decideOpportunity(agents,{now:new Date(now.getTime()+step*1000)});
    const selected=decision.selection!;
    counts[Number(selected.agentId)]++;
    agents=agents.map(agent=>({...agent,balance:decision.candidates.find(c=>c.agentId===agent.agentId)!.balanceAfter,
      lastAssignedAt:agent.agentId===selected.agentId?new Date(now.getTime()+step*1000).toISOString():agent.lastAssignedAt}));
    if (new Set(capacities).size===1) expect(Math.max(...counts)-Math.min(...counts)).toBeLessThanOrEqual(1);
  }
  return counts;
}
afterEach(()=>vi.unstubAllEnvs());
describe('protected opportunity fairness',()=>{
  it('keeps equal continuous opportunities within one assignment at every prefix',()=>{
    expect(simulate([6,6,6],3000)).toEqual([1000,1000,1000]);
  });
  it('converges to capacity proportions rather than equal raw totals',()=>{
    expect(simulate([6,12,18],6000)).toEqual([1000,2000,3000]);
  });
  it('uses projected load, not just current load, and enforces the 25 point band',()=>{
    const result=decideOpportunity([candidate('busy',{effectiveLoad:5.5,balance:1}),candidate('free')],{now});
    expect(result.selection?.agentId).toBe('free');
    expect(result.candidates.find(c=>c.agentId==='busy')?.reason).toBe('capacity');
    const band=decideOpportunity([candidate('busy',{effectiveLoad:2,balance:1}),candidate('free')],{now});
    expect(band.candidates[0].reason).toBe('load_band');
    expect(band.candidates[0].credit).toBe(0);
    expect(decideOpportunity([candidate('busy',{effectiveLoad:1.5,balance:1}),candidate('free')],{now}).selection?.agentId).toBe('busy');
  });
  it('prioritizes minimum projected occupancy in overflow even with a larger debt elsewhere',()=>{
    const result=decideOpportunity([candidate('busy',{effectiveLoad:9,balance:1}),candidate('less',{effectiveLoad:7,balance:-1})],{now});
    expect(result.selection?.agentId).toBe('less');
    expect(result.selection?.overflow).toBe(true);
    expect(decideOpportunity([candidate('busy',{effectiveLoad:9})],{allowOverflow:false}).selection).toBeNull();
  });
  it('keeps large portfolios eligible and excludes only the transferring operator',()=>{
    const result=decideOpportunity([candidate('sender'),candidate('full',{portfolioCount:25}),candidate('other')],{excludeAgentId:'sender',now});
    expect(result.selection?.agentId).toBe('full');
    expect(result.candidates.map(c=>[c.reason,c.credit])).toEqual([['sender',0],['eligible',0.5],['eligible',0.5]]);
  });
  it.each([25,26,100,1000])('does not impose a replacement ceiling at %i conversations',portfolioCount=>{
    const result=decideOpportunity([candidate('large',{portfolioCount,maxPortfolio:1,effectiveLoad:2.75})],{now});
    expect(result.selection).toMatchObject({agentId:'large',maxPortfolio:null,overflow:false});
    expect(result.candidates[0].reason).toBe('eligible');
  });
  it('allows the already-owned chat at a full portfolio without adding its load twice',()=>{
    expect(decideOpportunity([candidate('owner',{portfolioCount:25,incomingAlreadyOwned:true,effectiveLoad:4})]).selection?.occupancy).toBeCloseTo(4/6);
  });
  it('paces new arrivals, preserves a sole available operator, and caps carried credit',()=>{
    const newcomer=candidate('new',{balance:100,onlineSince:now.toISOString(),lastAssignedAt:now.toISOString()});
    const result=decideOpportunity([newcomer,candidate('other')],{now});
    expect(result.candidates[0]).toMatchObject({reason:'entry_pacing',credit:0,balanceBefore:1});
    expect(decideOpportunity([newcomer],{now}).selection?.agentId).toBe('new');
    expect(decideOpportunity([newcomer,candidate('other')],{now:new Date(now.getTime()+60_000)}).selection?.agentId).toBe('new');
  });
  it('is deterministic regardless of query result order',()=>{
    const agents=[candidate('b'),candidate('a'),candidate('c')];
    expect(decideOpportunity(agents,{now})).toMatchObject({selection:{agentId:'a'}});
    expect(decideOpportunity([...agents].reverse(),{now}).selection?.agentId).toBe('a');
  });
  it('protects projected load as conversations arrive, receive replies and close',()=>{
    let agents=[candidate('a'),candidate('b'),candidate('c')];
    let jobs:Array<{owner:string;assigned:number;answered:boolean}>=[];
    let protectedDecisions=0,overflowDecisions=0;
    for(let tick=0;tick<600;tick++) {
      jobs=jobs.filter(job=>tick-job.assigned<30);
      // Different response rates exercise varying loads rather than fixed empty portfolios.
      for(const job of jobs) if(tick-job.assigned>({a:18,b:7,c:3}[job.owner]??3))job.answered=true;
      agents=agents.map(agent=>({...agent,portfolioCount:jobs.filter(job=>job.owner===agent.agentId).length,
        effectiveLoad:jobs.filter(job=>job.owner===agent.agentId).reduce((sum,job)=>sum+(job.answered?.25:1.25),0)}));
      const decision=decideOpportunity(agents,{now:new Date(now.getTime()+tick*60_000)});
      if(!decision.selection)continue;
      const winner=decision.selection;
      expect(winner.maxPortfolio).toBeNull();
      if(winner.overflow)overflowDecisions++;else expect(winner.occupancy).toBeLessThanOrEqual(1);
      if(decision.candidates.some(row=>row.reason==='capacity'||row.reason==='load_band'))protectedDecisions++;
      jobs.push({owner:winner.agentId,assigned:tick,answered:false});
      agents=agents.map(agent=>({...agent,balance:decision.candidates.find(row=>row.agentId===agent.agentId)!.balanceAfter,
        lastAssignedAt:agent.agentId===winner.agentId?new Date(now.getTime()+tick*60_000).toISOString():agent.lastAssignedAt}));
    }
    expect(protectedDecisions).toBeGreaterThan(0);
    expect(overflowDecisions).toBeGreaterThan(0);
  });
  it('rolls out by workspace consistently and defaults to the previous policy',()=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','');
    expect(distributionMode('workspace')).toBe('legacy');
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','shadow');vi.stubEnv('CHAT_DISTRIBUTION_WORKSPACES','workspace');
    expect(distributionMode('workspace')).toBe('shadow');expect(distributionMode('other')).toBe('legacy');
    vi.stubEnv('CHAT_DISTRIBUTION_ROLLOUT','0');expect(distributionMode('workspace')).toBe('legacy');
  });
});
