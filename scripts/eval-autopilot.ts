import { config } from 'dotenv';
import { createHmac } from 'node:crypto';

config({ quiet: true });

function printUsage() {
  console.log('Usage: npx tsx scripts/eval-autopilot.ts --offline');
  console.log('');
  console.log('Modes:');
  console.log('  --offline  Runs deterministic intent/RAG/workflow/tool/validator evals without LLM calls.');
  console.log('  --dra-roberta-live  Runs 12 local playground conversations against Dra. Roberta.');
  console.log('');
  console.log('Local live options:');
  console.log('  --base-url=http://localhost:3000');
  console.log('  Use DIALOGY_EVAL_COOKIE with your local authenticated browser cookie, or let the script create a local eval cookie from SUPABASE_JWT_SECRET.');
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signLocalSupabaseJwt(payload: Record<string, unknown>, secret: string) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.${signature}`;
}

async function createLocalEvalCookie(workspaceId: string): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET || '';
  if (!secret) return null;

  const { db } = await import('../src/lib/db');
  const member = await db.query(
    `SELECT user_id
     FROM user_workspace_roles
     WHERE workspace_id = $1
     ORDER BY created_at NULLS LAST
     LIMIT 1`,
    [workspaceId],
  );
  const userId = member.rows[0]?.user_id;
  if (!userId) return null;

  const now = Math.floor(Date.now() / 1000);
  const token = signLocalSupabaseJwt({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 60 * 60,
    app_metadata: {},
    user_metadata: {},
  }, secret);

  return `sb-access-token=${token}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const option = (name: string, fallback = '') => {
    const prefix = `${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
  };

  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  if (args.has('--dra-roberta-live')) {
    const baseUrl = option('--base-url', process.env.DIALOGY_EVAL_BASE_URL || 'http://localhost:3000');
    const {
      DRA_ROBERTA_AGENT_ID,
      DRA_ROBERTA_WORKSPACE_ID,
      runDraRobertaLocalPlaygroundEval,
    } = await import('../src/services/autopilot/dra-roberta-eval');
    const workspaceId = option('--workspace-id', process.env.DRA_ROBERTA_WORKSPACE_ID || DRA_ROBERTA_WORKSPACE_ID);
    const cookie = process.env.DIALOGY_EVAL_COOKIE?.trim()
      || option('--cookie')
      || await createLocalEvalCookie(workspaceId);
    if (!cookie) {
      console.error('Missing local auth cookie and could not create a local eval cookie. Set DIALOGY_EVAL_COOKIE or configure SUPABASE_JWT_SECRET.');
      process.exit(1);
    }
    const report = await runDraRobertaLocalPlaygroundEval({
      baseUrl,
      cookie,
      agentId: option('--agent-id', process.env.DRA_ROBERTA_AGENT_ID || DRA_ROBERTA_AGENT_ID),
      workspaceId,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.failed > 0) process.exit(1);
    return;
  }

  if (args.has('--live') || args.has('--compare')) {
    console.error('Use --dra-roberta-live for local live playground evals or --offline for CI-safe checks.');
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
