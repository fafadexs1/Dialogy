import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const serverOnlyStubPath = path.join(rootDir, 'scripts', 'server-only-stub.js');

function resolveSourceAlias(importPath) {
  const basePath = path.join(srcDir, importPath.slice(2));
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    basePath,
  ];

  const resolved = candidates.find((candidate) => {
    if (!fs.existsSync(candidate)) {
      return false;
    }

    const stat = fs.statSync(candidate);
    return stat.isFile();
  });
  if (!resolved) {
    throw new Error(`Alias nao resolvido para '${importPath}'`);
  }

  return resolved;
}

await build({
  entryPoints: [path.join(rootDir, 'scripts', 'simulate-signup-e2e.ts')],
  outfile: path.join(rootDir, 'dist', 'simulate-signup-e2e.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: true,
  tsconfig: path.join(rootDir, 'tsconfig.json'),
  logLevel: 'info',
  plugins: [
    {
      name: 'resolve-path-alias',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^server-only$/ }, () => ({
          path: serverOnlyStubPath,
        }));

        buildContext.onResolve({ filter: /^@\// }, (args) => ({
          path: resolveSourceAlias(args.path),
        }));

        buildContext.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith('@/')) {
            return null;
          }

          if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
            return null;
          }

          return {
            path: args.path,
            external: true,
          };
        });
      },
    },
  ],
});
