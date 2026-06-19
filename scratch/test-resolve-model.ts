import 'dotenv/config';
import { resolveAutopilotModelFromCatalog } from '../src/services/ai/model-selection';

async function main() {
  const resolved = await resolveAutopilotModelFromCatalog('lmstudio/google/gemma-4-12b-qat');
  console.log('Resolved model details:');
  console.log('- model:', resolved.model);
  console.log('- requestedModel:', resolved.requestedModel);
  console.log('- fallbackUsed:', resolved.fallbackUsed);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
