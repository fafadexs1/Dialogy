import 'dotenv/config';
import {Pool} from 'pg';
import {writeFile} from 'node:fs/promises';
import {listMcpServerTools,callMcpServerTool} from '../src/services/mcp/client';
const p=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
async function main(){try{
 const row=(await p.query("SELECT config FROM workspace_integrations WHERE workspace_id=$1 AND provider='mcp'",['e3b476a1-5de8-4744-80b5-a5d23fe15fab'])).rows[0];
 const server=row.config.servers.find((s:any)=>s.id==='8171892c-827b-4216-a631-02839d36af85');
 const live=await listMcpServerTools(server);
 const names=live.map((t:any)=>t.name||t.qualifiedName);
 const manual:any=await callMcpServerTool({server,toolName:'get_tool_manual',arguments:{tool_name:'get_router_details'},totalTimeoutMs:15000});
 const report={checkedAt:new Date().toISOString(),liveTools:names,manualSuccess:manual.isError!==true&&Array.isArray(manual.content)&&manual.content.length>0,routerCommandsSent:0};
 await writeFile('docs/lucas-mcp-20260915-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(!report.manualSuccess||live.length<9)throw Error('Verificação MCP falhou');
}finally{await p.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
