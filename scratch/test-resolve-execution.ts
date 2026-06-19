import 'dotenv/config';
import { resolveWorkspaceAiExecutionContext } from '../src/services/ai/runtime';

async function main() {
  const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
  const configId = '475cc308-03a6-483f-8fdd-10084f0c73b8';

  const context = await resolveWorkspaceAiExecutionContext(workspaceId, configId);
  console.log('Resolved Context Details:');
  console.log('- autopilotConfig name:', context.autopilotConfig?.name);
  console.log('- autopilotConfig ai_model:', context.autopilotConfig?.ai_model);
  console.log('- model:', context.model);
  console.log('- workspaceGeminiModel:', context.workspaceGeminiModel);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
