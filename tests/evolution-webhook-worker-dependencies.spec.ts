import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const handlerSource = readFileSync(
  path.join(process.cwd(), 'src/services/whatsapp/evolution-webhook-handler.ts'),
  'utf8',
);

describe('evolution webhook worker dependency boundary', () => {
  it('loads Genkit-dependent fallbacks only when the corresponding queue is inline', () => {
    expect(handlerSource).not.toMatch(
      /^import\s+\{\s*processAutopilotForChat\s*\}\s+from\s+['"]@\/services\/autopilot-service['"];?$/m,
    );
    expect(handlerSource).not.toMatch(
      /^import\s+\{\s*refreshCaseMemoryForChat\s*\}\s+from\s+['"]@\/services\/rag\/case-memory['"];?$/m,
    );
    expect(handlerSource).toContain("await import('@/services/autopilot-service')");
    expect(handlerSource).toContain("await import('@/services/rag/case-memory')");
  });
});
