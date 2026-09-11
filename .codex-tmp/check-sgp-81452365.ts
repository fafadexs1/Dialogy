import 'dotenv/config';
import { db } from '../src/lib/db';
import { lookupSgpCustomerContracts } from '../src/services/agent-tools/sgp-tools';
async function main(){try{const workspaceId='e3b476a1-5de8-4744-80b5-a5d23fe15fab';const chatId='db54bc43-8391-416c-aaf5-ce5d3d8f9be5';const {rows}=await db.query(`SELECT content FROM messages WHERE chat_id=$1 AND workspace_id=$2 AND from_me=false AND type='text' AND content ~ '^[0-9. /-]+$' ORDER BY created_at LIMIT 1`,[chatId,workspaceId]);if(rows.length!==1)throw new Error('Documento nao localizado');const result=await lookupSgpCustomerContracts({workspaceId,chatId,customerIdentifier:rows[0].content});console.log(JSON.stringify({status:result.status,contracts:result.status==='found'?result.contracts.map(c=>({id:c.id,status:c.statusLabel})):[]}));}finally{await db.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
