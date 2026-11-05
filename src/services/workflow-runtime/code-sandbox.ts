import vm from 'node:vm';

import { isRecord } from './utils';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !BLOCKED_KEYS.has(key))
      .map(([key, child]) => [key, jsonSafe(child, seen)]),
  );
}

export function executeSandboxedWorkflowCode(input: {
  source: string;
  current: Record<string, unknown>;
  variables: Record<string, unknown>;
  context: Record<string, unknown>;
  timeoutMs?: number;
}): Record<string, unknown> {
  const timeoutMs = Math.max(10, Math.min(5_000, input.timeoutMs || 2_000));
  const sandbox = {
    __current: structuredClone(input.current),
    __variables: structuredClone(input.variables),
    __context: structuredClone(input.context),
  };
  const context = vm.createContext(sandbox, {
    name: 'dialogy-workflow-code',
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `(function (input, variables, context) { "use strict";\n${input.source}\n})(__current, __variables, __context)`,
    { filename: 'dialogy-workflow-code.js' },
  );
  const value = script.runInContext(context, { timeout: timeoutMs, breakOnSigint: false });
  if (value && typeof (value as Promise<unknown>).then === 'function') {
    throw new Error('O bloco de código aceita somente JavaScript síncrono e isolado.');
  }
  const safe = jsonSafe(value);
  return isRecord(safe) ? safe : { value: safe };
}

