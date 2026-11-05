import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),broadcast:vi.fn(),notice:vi.fn(),event:vi.fn(),touch:vi.fn(),loseCommitAck:false,checkedOut:0,enforceSingle:false,postCommit:[] as Array<()=>Promise<void>>}));
vi.mock('@/lib/db',()=>({db:{query:(...args:unknown[])=>{if(mocks.enforceSingle && mocks.checkedOut)throw new Error('Pool exhausted: nested pool query');return mocks.query(...args);},connect:mocks.connect}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',user_metadata:{full_name:'A'}}}})}})}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:async()=>{if(mocks.enforceSingle && mocks.checkedOut)throw new Error('Pool exhausted: permission query inside transaction');return true;}}));
vi.mock('@/actions/messages',()=>({sendAutomatedMessageAction:mocks.notice}));
vi.mock('@/lib/realtime/chat-broadcast',()=>({broadcastHydratedChatUpdate:mocks.broadcast}));
vi.mock('@/lib/presence-server',()=>({touchUserPresenceActivity:mocks.touch}));
vi.mock('@/lib/observability/logger',()=>({withDebug:(_name:string,fn:unknown)=>fn,logAction:vi.fn()}));
vi.mock('@/modules/nexus/services/dialogy-event-scheduler',()=>({scheduleDialogyNexusInternalEvent:mocks.event}));
vi.mock('@/services/chat/post-commit',()=>({scheduleChatPostCommit:(_name:string,task:()=>Promise<void>)=>mocks.postCommit.push(task)}));
vi.mock('@/lib/workspace-config',()=>({getWorkspaceTemplates:async()=>{if(mocks.enforceSingle && mocks.checkedOut)throw new Error('Pool exhausted: template query inside transaction');return {transferTeamMessageTemplate:'Encaminhado para {{dest}}',closeMessageTemplate:'Encerrado'};},getWorkspaceTimezone:async()=>'America/Sao_Paulo'}));
vi.mock('@/services/rag/case-memory',()=>({refreshCaseMemoryForChat:vi.fn()}));
vi.mock('@/services/autopilot/outcome-tracker',()=>({recordDecisionOutcomesForChat:vi.fn()}));
vi.mock('@/lib/queue',()=>({enqueueAiAutopilotProcess:vi.fn(),enqueueAiCaseMemoryRefresh:vi.fn(),shouldEnqueueJob:()=>false}));
vi.mock('@/server/inbox/access',()=>({requireChatAccess:async()=>({ok:true}),requireWorkspaceAccess:async()=>({ok:true})}));
vi.mock('@/lib/whatsapp/chat-dedupe',()=>({dedupeActiveWhatsappChatsByIdentity:vi.fn()}));
vi.mock('@/lib/whatsapp/contact-thread',()=>({mergeEquivalentContacts:vi.fn()}));
vi.mock('@/server/inbox/contact-thread-service',()=>({loadContactThreadContext:vi.fn()}));
import {transferChatAction,assignChatToSelfAction,closeChatAction,transferChatToIntelligentAgentAction} from '@/actions/chats';

const workspace='11111111-1111-1111-1111-111111111111',team='33333333-3333-3333-3333-333333333333';
const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',chat='55555555-5555-5555-5555-555555555555';
let sql:PGlite;
beforeAll(async()=>{
  sql=new PGlite();
  await sql.exec(readFileSync('tests/fixtures/chat-distribution-schema.sql','utf8'));
  await sql.exec(readFileSync('prisma/migrations/20260713100000_fair_chat_distribution/migration.sql','utf8'));
  await sql.exec(readFileSync('prisma/migrations/20261028141517_protected_opportunity_distribution/migration.sql','utf8'));
  await sql.exec(`ALTER TABLE users ADD avatar_url text;
    ALTER TABLE teams ADD tag_id uuid;
    ALTER TABLE workspaces ADD owner_id uuid;
    ALTER TABLE chats ADD team_id uuid,ADD assigned_system_agent_id uuid,ADD is_autopilot_active boolean,ADD copilot_mode text,
      ADD updated_at timestamptz,ADD tag text,ADD color text,ADD closed_at timestamptz,ADD close_reason_tag_id uuid,ADD close_notes text,ADD contact_id uuid,ADD autopilot_config_id uuid;
    ALTER TABLE messages ADD content text,ADD instance_name text,ADD is_read boolean,ADD sender_system_agent_id uuid;
    CREATE TABLE meta_conversations(chat_id uuid,status text,updated_at timestamptz);
    CREATE TABLE workflow_executions(workspace_id uuid,conversation_id text,session_id text,status text,updated_at timestamptz);
    CREATE TABLE autopilot_configs(id uuid,is_active boolean);
    CREATE TABLE system_agents(id uuid,workspace_id uuid,name text,autopilot_config_id uuid,is_active boolean,type text,team_id uuid);
    INSERT INTO autopilot_configs VALUES('99999999-9999-9999-9999-999999999999',true);
    INSERT INTO system_agents VALUES('88888888-8888-8888-8888-888888888888','${workspace}','IA','99999999-9999-9999-9999-999999999999',true,'intelligent_attendant','${team}');
    CREATE TABLE tags(id uuid,workspace_id uuid,label text,color text);
    CREATE TABLE business_hours(id uuid,team_id uuid);
    CREATE TABLE schedule_exceptions(id uuid,team_id uuid,date date);
    CREATE TABLE user_workspace_roles(user_id uuid,workspace_id uuid);
    INSERT INTO workspaces(id,timezone) VALUES('${workspace}','America/Sao_Paulo');
    INSERT INTO users(id,full_name) VALUES('${a}','A'),('${b}','B');
    INSERT INTO teams VALUES('${team}','${workspace}','Comercial',NULL);
    INSERT INTO team_members VALUES('${team}','${a}'),('${team}','${b}');
    INSERT INTO user_workspace_roles VALUES('${a}','${workspace}'),('${b}','${workspace}');
    INSERT INTO user_workspace_presence VALUES('${a}','${workspace}',true,NOW(),NOW(),NOW()-interval '1 hour'),
      ('${b}','${workspace}',true,NOW(),NOW(),NOW()-interval '1 hour');`);
  mocks.query.mockImplementation(async(query:string,params?:unknown[])=>{
    // Hydration is deliberately failed after COMMIT to also exercise confirmed-result recovery.
    if(query.includes('WITH') && query.includes('chat_ids')) throw new Error('Hydration unavailable');
    const result=await sql.query(query,params);
    if(query==='COMMIT' && mocks.loseCommitAck) {mocks.loseCommitAck=false;throw new Error('Commit acknowledgement lost');}
    return {...result,rowCount:result.rows.length || result.affectedRows || 0};
  });
  mocks.connect.mockImplementation(async()=>{
    if(mocks.enforceSingle && mocks.checkedOut)throw new Error('Pool exhausted: nested connect');
    mocks.checkedOut++;
    let released=false;
    return {query:mocks.query,release:vi.fn(()=>{if(!released){released=true;mocks.checkedOut--;}})};
  });
});
beforeEach(async()=>{
  vi.clearAllMocks();mocks.loseCommitAck=false;mocks.checkedOut=0;mocks.enforceSingle=false;mocks.postCommit=[];vi.stubEnv('CHAT_DISTRIBUTION_MODE','active');
  mocks.notice.mockResolvedValue({success:true});mocks.broadcast.mockResolvedValue(undefined);mocks.touch.mockResolvedValue(undefined);
  await sql.exec(`TRUNCATE chat_transfer_operations,chat_assignment_events,opportunity_distribution_state,team_agent_distribution_state,messages,chats CASCADE;
    INSERT INTO chats(id,workspace_id,agent_id,status,team_id,assigned_at)
      VALUES('${chat}','${workspace}','${a}','atendimentos','${team}',NOW()-interval '1 hour');`);
});
afterAll(async()=>{vi.unstubAllEnvs();await sql.close();});
describe('transactional transfer operations',()=>{
  it('confirms one owner and one opportunity when the same transfer is retried five times',async()=>{
    const input={chatId:chat,teamId:team,operationId:'intent-1',expectedAgentId:a,expectedTeamId:team};
    const first=await transferChatAction(input);
    expect(first).toMatchObject({success:true,outcome:'assigned',assignedAgent:{id:b}});
    for(let i=0;i<5;i++)expect(await transferChatAction(input)).toMatchObject({success:true,replayed:true,assignedAgent:{id:b}});
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
    expect((await sql.query('SELECT * FROM chat_transfer_operations')).rows).toHaveLength(1);
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect((await sql.query<{agent_id:string}>('SELECT agent_id FROM chats')).rows[0].agent_id).toBe(b);
  });
  it('rejects stale state without credit or audit mutations',async()=>{
    const result=await transferChatAction({chatId:chat,teamId:team,operationId:'stale',expectedAgentId:b,expectedTeamId:team});
    expect(result).toMatchObject({success:false,outcome:'conflict'});
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(0);
    expect((await sql.query('SELECT * FROM opportunity_distribution_state')).rows).toHaveLength(0);
  });
  it('returns no_op without sending a notice or changing assignment time',async()=>{
    const before=(await sql.query<{assigned_at:string}>('SELECT assigned_at FROM chats')).rows[0].assigned_at;
    expect(await transferChatAction({chatId:chat,agentId:a,operationId:'keep-owner',expectedAgentId:a,expectedTeamId:team}))
      .toMatchObject({success:true,outcome:'no_op',assignedAgent:{id:a}});
    expect((await sql.query<{assigned_at:string}>('SELECT assigned_at FROM chats')).rows[0].assigned_at).toEqual(before);
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(0);
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it('rejects a reused key with a different explicit destination',async()=>{
    await transferChatAction({chatId:chat,agentId:b,operationId:'one-key'});
    expect(await transferChatAction({chatId:chat,agentId:a,operationId:'one-key'})).toMatchObject({success:false,outcome:'conflict'});
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
  });
  it('recovers a lost COMMIT acknowledgement from the operation journal',async()=>{
    mocks.loseCommitAck=true;
    const intent={chatId:chat,teamId:team,operationId:'lost-ack',expectedAgentId:a,expectedTeamId:team};
    expect(await transferChatAction(intent)).toMatchObject({success:true,outcome:'assigned',assignedAgent:{id:b}});
    expect(await transferChatAction(intent)).toMatchObject({success:true,replayed:true,assignedAgent:{id:b}});
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
    expect(mocks.broadcast).toHaveBeenCalled();
  });

  it.each(['legacy','shadow','active'])('transfers directly above the former ceiling in %s mode',async(mode)=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE',mode);
    await sql.query(`INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(),$1,$2,'atendimentos'
      FROM generate_series(1,25)`,[workspace,b]);
    const result=await transferChatAction({chatId:chat,agentId:b,operationId:'full'});
    expect(result).toMatchObject({success:true,operationId:'full',outcome:'assigned',assignedAgent:{id:b}});
    expect((await sql.query<{agent_id:string}>('SELECT agent_id FROM chats WHERE id=$1',[chat])).rows[0].agent_id).toBe(b);
    expect((await sql.query<{count:number}>("SELECT COUNT(*)::int AS count FROM chats WHERE agent_id=$1 AND status='atendimentos'",[b])).rows[0].count).toBe(26);
    expect((await sql.query('SELECT * FROM chat_transfer_operations')).rows).toHaveLength(1);
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
    expect(await transferChatAction({chatId:chat,agentId:b,operationId:'full'})).toMatchObject({success:true,replayed:true});
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
  });

  it('allows a direct transfer at the former 25 conversation boundary',async()=>{
    await sql.query(`INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(),$1,$2,'atendimentos'
      FROM generate_series(1,24)`,[workspace,b]);
    expect(await transferChatAction({chatId:chat,agentId:b,operationId:'last-slot'}))
      .toMatchObject({success:true,outcome:'assigned',assignedAgent:{id:b}});
    expect((await sql.query<{count:number}>("SELECT COUNT(*)::int AS count FROM chats WHERE agent_id=$1 AND status='atendimentos'",[b])).rows[0].count).toBe(25);
  });

  it('ignores a saved individual ceiling even above 100 conversations',async()=>{
    await sql.query(`INSERT INTO team_agent_distribution_state(workspace_id,team_id,user_id,max_portfolio)
      VALUES($1,$2,$3,1)`,[workspace,team,b]);
    await sql.query(`INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(),$1,$2,'atendimentos'
      FROM generate_series(1,100)`,[workspace,b]);
    expect(await transferChatAction({chatId:chat,agentId:b,operationId:'unlimited'}))
      .toMatchObject({success:true,outcome:'assigned',assignedAgent:{id:b}});
    expect((await sql.query<{count:number}>("SELECT COUNT(*)::int AS count FROM chats WHERE agent_id=$1 AND status='atendimentos'",[b])).rows[0].count).toBe(101);
  });

  it('allows taking queued chats beyond the former portfolio ceiling',async()=>{
    await sql.query("UPDATE chats SET status='gerais' WHERE id=$1",[chat]);
    await sql.query(`INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(),$1,$2,'atendimentos'
      FROM generate_series(1,24)`,[workspace,a]);
    expect(await assignChatToSelfAction(chat)).toMatchObject({success:true});
    const next='66666666-6666-6666-6666-666666666666';
    await sql.query("INSERT INTO chats(id,workspace_id,status) VALUES($1,$2,'gerais')",[next,workspace]);
    expect(await assignChatToSelfAction(next)).toMatchObject({success:true});
    expect((await sql.query<{count:number}>("SELECT COUNT(*)::int AS count FROM chats WHERE agent_id=$1 AND status='atendimentos'",[a])).rows[0].count).toBe(26);
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(2);
  });

  it('transfers and replays with one available pool connection',async()=>{
    mocks.enforceSingle=true;
    mocks.broadcast.mockImplementation(async()=>{if(mocks.checkedOut)throw new Error('Transaction client still reserved during broadcast');});
    const input={chatId:chat,teamId:team,operationId:'single-connection',expectedAgentId:a,expectedTeamId:team};
    expect(await transferChatAction(input)).toMatchObject({success:true,outcome:'assigned'});
    expect(mocks.checkedOut).toBe(0);
    expect(await transferChatAction(input)).toMatchObject({success:true,replayed:true});
    expect(mocks.checkedOut).toBe(0);
  });

  it.each(['gerais','atendimentos'])('closes a %s chat with a one-connection pool before ancillary work',async(status)=>{
    mocks.enforceSingle=true;
    await sql.query('UPDATE chats SET status=$1 WHERE id=$2',[status,chat]);
    expect(await closeChatAction(chat,null,'Teste',false)).toEqual({success:true});
    expect(mocks.checkedOut).toBe(0);
    expect((await sql.query<{status:string}>('SELECT status FROM chats WHERE id=$1',[chat])).rows[0].status).toBe('encerrados');
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.postCommit).toHaveLength(1);
    await mocks.postCommit[0]();
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
  });

  it('releases the connection before the first AI response is scheduled',async()=>{
    mocks.enforceSingle=true;
    expect(await transferChatToIntelligentAgentAction({chatId:chat,systemAgentId:'88888888-8888-8888-8888-888888888888'}))
      .toMatchObject({success:true});
    expect(mocks.checkedOut).toBe(0);
    expect((await sql.query<{assigned_system_agent_id:string}>('SELECT assigned_system_agent_id FROM chats WHERE id=$1',[chat])).rows[0].assigned_system_agent_id)
      .toBe('88888888-8888-8888-8888-888888888888');
    expect(mocks.postCommit).toHaveLength(1);
  });

});
