require('dotenv').config({path:'.env',quiet:true});
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});await c.connect();
await c.query('SET default_transaction_read_only = on');
const r=await c.query(`select metadata->'templateComponents' tc from messages where metadata::text ilike '%fatura_19463%' order by created_at desc limit 1`);
console.log(JSON.stringify(r.rows[0].tc.filter(x=>x.type!=='header'),null,1).slice(0,2500));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});
