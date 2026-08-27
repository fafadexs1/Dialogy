import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Dialogy Docker port', () => {
  it('uses PORT from .env for both the published and application ports', () => {
    const compose = readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('PORT: ${PORT:-9045}');
    expect(compose).toContain('- "${PORT:-9045}:${PORT:-9045}"');
  });
});
