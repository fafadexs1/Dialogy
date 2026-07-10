import 'dotenv/config';

import { db } from '../src/lib/db';
import { cutoverAllAutopilotConfigs } from '../src/services/workflow-runtime/autopilot-cutover';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const result = await cutoverAllAutopilotConfigs({
    database: db,
    workspaceId: argument('workspace'),
    configId: argument('config'),
    apply: process.argv.includes('--apply'),
  });
  const verbose = process.argv.includes('--verbose');
  const printable = verbose ? result : {
    ...result,
    results: result.results.map((item) => {
      const { workflow: _workflow, ...summary } = item;
      return summary;
    }),
  };
  console.log(JSON.stringify(printable, null, 2));
}

main()
  .then(() => db.end())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.end();
    process.exitCode = 1;
  });
