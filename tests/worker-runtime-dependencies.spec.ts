import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const isIgnoredOrBuiltinModule = (mod: string) =>
  mod.startsWith('node:') ||
  ['fs', 'os', 'path', 'crypto', 'http', 'https', 'net', 'dns', 'events', 'util', 'stream', 'buffer', 'url', 'tls', 'assert', 'child_process', 'querystring', 'zlib', 'dotenv'].includes(mod);

function getRootPackageName(importPath: string): string {
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return `${parts[0]}/${parts[1]}`;
  }
  return importPath.split('/')[0];
}

describe('worker runtime dependencies in Dockerfile', () => {
  it('includes all required external npm packages in Dockerfile runtime dependency lists', () => {
    const dockerfileContent = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');

    // Extract names arrays from Dockerfile
    const matches = Array.from(dockerfileContent.matchAll(/const names=\[([^\]]+)\]/g));
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const parseNames = (rawStr: string): string[] =>
      rawStr
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);

    const workerDepsNames = parseNames(matches[0][1]);
    const workerAiDepsNames = parseNames(matches[1][1]);

    // Workflow/Nexus expressions can be reached from both queue runtimes.
    // Keep this explicit even when dist/ has not been generated yet.
    expect(workerDepsNames).toContain('jsonata');
    expect(workerAiDepsNames).toContain('jsonata');

    // Check worker-ai dist
    const workerAiDistPath = path.join(process.cwd(), 'dist', 'worker-ai.js');
    if (existsSync(workerAiDistPath)) {
      const code = readFileSync(workerAiDistPath, 'utf8');
      const requires = Array.from(code.matchAll(/require\("([^"]+)"\)/g), (m) => m[1]);
      const externalRequires = Array.from(
        new Set(
          requires
            .filter((req) => !isIgnoredOrBuiltinModule(req) && !req.startsWith('.'))
            .map(getRootPackageName)
        )
      );

      const missingWorkerAi: string[] = [];
      for (const reqPkg of externalRequires) {
        if (!workerAiDepsNames.includes(reqPkg)) {
          missingWorkerAi.push(reqPkg);
        }
      }
      expect(
        missingWorkerAi,
        `Missing worker-ai packages in Dockerfile: ${missingWorkerAi.join(', ')}`,
      ).toEqual([]);
    }

    // Check worker, worker-campaign, worker-meta-relay dist files
    const genericWorkerFiles = ['worker.js', 'worker-campaign.js', 'worker-meta-relay.js', 'worker-nexus.js'];
    for (const fileName of genericWorkerFiles) {
      const distPath = path.join(process.cwd(), 'dist', fileName);
      if (!existsSync(distPath)) continue;

      const code = readFileSync(distPath, 'utf8');
      const requires = Array.from(code.matchAll(/require\("([^"]+)"\)/g), (m) => m[1]);
      const externalRequires = Array.from(
        new Set(
          requires
            .filter((req) => !isIgnoredOrBuiltinModule(req) && !req.startsWith('.'))
            .map(getRootPackageName)
        )
      );

      const missingWorker: string[] = [];
      for (const reqPkg of externalRequires) {
        if (!workerDepsNames.includes(reqPkg)) {
          missingWorker.push(reqPkg);
        }
      }
      expect(
        missingWorker,
        `Missing ${fileName} packages in Dockerfile worker-deps: ${missingWorker.join(', ')}`,
      ).toEqual([]);
    }
  });
});
