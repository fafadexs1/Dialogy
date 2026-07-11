import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';

const root = process.cwd();
const src = path.join(root, 'src');

function resolveAlias(importPath) {
  const base = path.join(src, importPath.slice(2));
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base];
  const found = candidates.find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
  if (!found) throw new Error(`Alias nao resolvido: ${importPath}`);
  return found;
}

await build({
  entryPoints: [path.join(src, 'worker-meta-relay.ts')],
  outfile: path.join(root, 'dist', 'worker-meta-relay.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  plugins: [{
    name: 'aliases',
    setup(context) {
      context.onResolve({ filter: /^server-only$/ }, () => ({ path: path.join(root, 'scripts', 'server-only-stub.js') }));
      context.onResolve({ filter: /^@\// }, (args) => ({ path: resolveAlias(args.path) }));
      context.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('.') || path.isAbsolute(args.path)) return null;
        return { path: args.path, external: true };
      });
    },
  }],
});
