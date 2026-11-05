import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
import {dispatchNexusChatMessage} from '../src/modules/nexus/services/chat-adapters';
const ws='e3b476a1-5de8-4744-80b5-a5d23fe15fab';
async function main(){
 const contactId=randomUUID(),chatId=randomUUID(),messageId=randomUUID();
 const evidencePath='docs/lucas-nexus-20260915-live.json';
 try{
  const c=await db.connect();try{
   await c.query('BEGIN');
   await c.query("INSERT INTO contacts(id,workspace_id,name,phone,phone_number_jid,created_at) VALUES($1,$2,'[Teste IA] Lucas · ativação Nexus 15/09','',$3,now())",[contactId,ws,`webchat:test-lucas:${chatId}`]);
   await c.query("INSERT INTO chats(id,workspace_id,contact_id,status,protocol,is_autopilot_active,copilot_mode,source,last_activity_at) VALUES($1,$2,$3,'gerais',$4,FALSE,'off','webchat',now())",[chatId,ws,contactId,`TESTE-LUCAS-${chatId.slice(0,8).toUpperCase()}`]);
   await c.query("INSERT INTO messages(id,workspace_id,chat_id,type,content,from_me,is_read,api_message_status,instance_name,source_from_api,metadata,created_at) VALUES($1,$2,$3,'text','cabral',FALSE,TRUE,'RECEIVED','Teste Lucas','webchat',$4::jsonb,clock_timestamp())",[messageId,ws,chatId,JSON.stringify({test:true,purpose:'Verificação automática do fluxo Ativar IA Comercial para Lucas'})]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await writeFile(evidencePath,JSON.stringify({workspaceId:ws,contactId,chatId,messageId,startedAt:new Date().toISOString()},null,2));
  const result=await dispatchNexusChatMessage({workspaceId:ws,chatId,message:'cabral',sourceMessageId:messageId,platform:'webchat',instanceName:'Teste Lucas'});
  const chat=(await db.query('SELECT id,status,assigned_system_agent_id,autopilot_config_id,is_autopilot_active,team_id FROM chats WHERE workspace_id=$1 AND id=$2',[ws,chatId])).rows[0];
  const runs=(await db.query('SELECT workflow_id,workflow_version,status,id FROM workflow_executions WHERE workspace_id=$1 AND conversation_id=$2',[ws,chatId])).rows;
  const events=(await db.query("SELECT content,metadata->>'nexus_caused_by_execution_id' AS execution_id,metadata->>'nexus_caused_by_node_id' AS node_id FROM messages WHERE workspace_id=$1 AND chat_id=$2 AND metadata->>'event'='transfer_to_intelligent_attendant'",[ws,chatId])).rows;
  const passed=chat.autopilot_config_id==='7d7259ab-a6c3-4057-a9ca-28ddbb15db95'&&chat.assigned_system_agent_id==='779c0e28-b9c2-4604-9496-44d56cece388'&&chat.is_autopilot_active===true&&events.some(e=>e.execution_id)&&runs.some(r=>r.workflow_version==='v5'&&r.status==='completed');
  const report={checkedAt:new Date().toISOString(),workspaceId:ws,contactId,chatId,messageId,handled:result.handled,passed,chat,runs,events,testChannel:'webchat',realPhoneProvided:false,scope:'Real published Nexus dispatcher and native transfer; no manual chat assignment.'};
  await writeFile(evidencePath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(!passed)throw Error('Transferência automática não foi confirmada.');
 }finally{await db.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
