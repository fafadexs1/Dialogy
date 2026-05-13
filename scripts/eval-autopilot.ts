import { config } from 'dotenv';

config({ quiet: true });

function printUsage() {
  console.log('Usage: npx tsx scripts/eval-autopilot.ts --offline');
  console.log('');
  console.log('Modes:');
  console.log('  --offline  Runs deterministic intent/RAG/workflow/tool/validator evals without LLM calls.');
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  if (args.has('--live') || args.has('--compare')) {
    console.error('Live/compare evals are not implemented yet. Use --offline for CI-safe regression checks.');
    process.exit(1);
  }

  const { runOfflineAutopilotEvals } = await import('../src/services/autopilot/eval-runner');
  const report = runOfflineAutopilotEvals();
  const failedCases = report.failures.map((failure) => ({
    id: failure.id,
    title: failure.title,
    failures: failure.failures,
    actual: report.results.find((result) => result.id === failure.id)?.actual,
  }));

  console.log(JSON.stringify({
    mode: report.mode,
    generatedAt: report.generatedAt,
    summary: report.summary,
    failedCases,
  }, null, 2));

  if (report.summary.failed > 0 || report.summary.unexpectedFallbackRate > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
