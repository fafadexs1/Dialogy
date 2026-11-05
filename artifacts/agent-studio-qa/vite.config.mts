import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const local = (file: string) => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  root: local('./'),
  resolve: { alias: [
    { find: '@/actions/agent-studio', replacement: local('./mock-actions.ts') },
    { find: '@/actions/mcp', replacement: local('./mock-actions.ts') },
    { find: '@', replacement: local('../../src') },
  ] },
  esbuild: { jsx: 'automatic' },
  css: { postcss: local('../../') },
  server: { host: '127.0.0.1', port: 9052, strictPort: true, fs: { allow: [local('../../')] } },
});
