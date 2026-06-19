import { runAutopilotLearningCycle } from '@/services/autopilot/learning-cycle';

async function loadEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  try {
    await import('dotenv/config');
  } catch {
    console.warn('[AUTOPILOT_LEARNING_CYCLE] dotenv/config not available. Skipping local .env loading.');
  }
}

function parseOptionalInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined) {
  if (!value) return false;
  return ['1', 'true', 'yes', 'sim'].includes(value.trim().toLowerCase());
}

async function main() {
  await loadEnvironment();

  const result = await runAutopilotLearningCycle({
    workspaceId: process.env.AUTOPILOT_LEARNING_WORKSPACE_ID?.trim() || null,
    vertical: process.env.AUTOPILOT_LEARNING_VERTICAL?.trim() || null,
    sinceDays: parseOptionalInteger(process.env.AUTOPILOT_LEARNING_SINCE_DAYS),
    limit: parseOptionalInteger(process.env.AUTOPILOT_LEARNING_WORKSPACE_LIMIT),
    dryRun: parseBoolean(process.env.AUTOPILOT_LEARNING_DRY_RUN),
    promoteEcosystem: !parseBoolean(process.env.AUTOPILOT_LEARNING_SKIP_ECOSYSTEM_PROMOTION),
    createScoreSuggestions: !parseBoolean(process.env.AUTOPILOT_LEARNING_SKIP_SCORE_SUGGESTIONS),
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.results.some((item) => item.error)) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('[AUTOPILOT_LEARNING_CYCLE] Failed:', error);
  process.exitCode = 1;
});
