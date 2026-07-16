import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], { encoding: 'utf8' })
  : spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (!result.stdout) {
  console.error(result.stderr || '[dependency-audit] npm audit did not return a report.');
  process.exit(1);
}

const report = JSON.parse(result.stdout);
const counts = report.metadata?.vulnerabilities || {};
const maxHigh = Number(process.env.MAX_HIGH_VULNERABILITIES || 5);
console.log(`[dependency-audit] critical=${counts.critical || 0} high=${counts.high || 0} moderate=${counts.moderate || 0}`);

if ((counts.critical || 0) > 0 || (counts.high || 0) > maxHigh) {
  console.error(`[dependency-audit] Budget exceeded (critical=0, high<=${maxHigh}).`);
  process.exit(1);
}
