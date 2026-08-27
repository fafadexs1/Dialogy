import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dialogy-nexus docker service', () => {
  const root = process.cwd();
  const compose = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const releaseScript = readFileSync(path.join(root, 'scripts', 'docker-release.ps1'), 'utf8');

  it('runs the native Nexus worker once and exposes a container healthcheck', () => {
    expect(compose).toContain('dialogy-nexus:');
    expect(compose).toContain('command: ["node", "dist/worker-nexus.js"]');
    expect(compose).toContain("fetch('http://127.0.0.1:9050/health')");
    expect(compose).toMatch(/worker:[\s\S]*?NEXUS_SCHEDULE_ENABLED: "false"[\s\S]*?dialogy-nexus:/);
  });

  it('ships the Nexus worker in the reusable Dialogy worker image', () => {
    expect(dockerfile).toContain('npm run worker:nexus:build');
    expect(dockerfile).toContain('/app/dist/worker-nexus.js ./dist/worker-nexus.js');
    expect(releaseScript).toContain("currentService -eq 'dialogy-nexus'");
  });
});
