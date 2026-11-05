import {config} from 'dotenv';
import {Client} from 'pg';
import {distributionRolloutMetrics} from '../src/services/chat-distribution/rollout-metrics';
config({quiet:true});
async function main() {
  const args=process.argv.slice(2);
  const workspaceId=args[args.indexOf('--workspace-id')+1];
  const since=new Date(args[args.indexOf('--since')+1]);
  const until=args.includes('--until')?new Date(args[args.indexOf('--until')+1]):new Date();
  if(!args.includes('--workspace-id') || !/^[0-9a-f-]{36}$/i.test(workspaceId) || !args.includes('--since') ||
    !Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || until<=since || until.getTime()-since.getTime()>14*86400_000)
    throw new Error('Use --workspace-id <uuid> --since <ISO date> [--until <ISO date>], maximum 14 days.');
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='30s'");
    const result=await distributionRolloutMetrics(client,workspaceId,since,until);
    await client.query('ROLLBACK');console.log(JSON.stringify(result,null,2));
  } finally {await client.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
