import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Preserve the project's pre-ESLint-9 baseline while keeping correctness
    // rules (including Rules of Hooks) active. These can be tightened
    // incrementally without making the lint command unusable on day one.
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'off',
      'prefer-rest-params': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.next-*/**',
    'dist/**',
    'coverage/**',
    'test-results/**',
    'scratch/**',
    'tmp/**',
    'public/sw.js',
    'delivery-app/**',
    'next-env.d.ts',
  ]),
]);
