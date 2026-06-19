import 'dotenv/config';
import { isAllowedAutopilotModel } from '../src/services/ai/model-selection';

async function main() {
  const allowed = await isAllowedAutopilotModel('lmstudio/google/gemma-4-12b-qat');
  console.log('Is lmstudio/google/gemma-4-12b-qat allowed?', allowed);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
