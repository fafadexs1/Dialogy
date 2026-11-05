import 'dotenv/config';
import { db } from '../src/lib/db';
import { decryptWithKey } from '../src/lib/security/secret-box';

async function main() {
  const row = (await db.query("SELECT metadata FROM autopilot_conversation_states WHERE chat_id='e7e596b8-4d5d-4645-a3b8-219077767920'")).rows[0];
  const studio = row?.metadata?.agent_studio;
  const secret = process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY || process.env.META_PAYLOAD_ENCRYPTION_KEY;
  const decrypted = decryptWithKey(studio.encrypted, secret!, 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY');
  const payload = JSON.parse(decrypted);
  console.log('Decrypted state:');
  console.log('Requests:', JSON.stringify(payload.state?.reasoning?.requests, null, 2));
  console.log('Operations:', JSON.stringify(payload.state?.reasoning?.operations, null, 2));
  console.log('Values:', JSON.stringify(payload.state?.values, null, 2));
  console.log('Last turn:', JSON.stringify(payload.state?.lastTurn, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
