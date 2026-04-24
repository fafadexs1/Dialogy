import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config(); // Load .env file

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/tests/seo-audit.spec.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
      'server-only': path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'tests/server-only-stub.ts'),
    },
  },
});
