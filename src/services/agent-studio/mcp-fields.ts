export type StudioMcpField = { title: string; type?: string; description?: string; enum?: unknown[]; required: boolean };

/** Expose nested object leaves as guided fields; retain arrays and open objects as typed JSON values. */
export function studioMcpFields(schema: Record<string, unknown> | null | undefined): Record<string, StudioMcpField> {
  const result: Record<string, StudioMcpField> = {};
  const visit = (node: Record<string, unknown>, path: string, label: string, required: boolean, depth: number) => {
    if (depth > 5 || Object.keys(result).length >= 80) return;
    const properties = node.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length) {
      for (const [key, value] of Object.entries(properties)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
        const child = value as Record<string, unknown>;
        visit(child, path ? `${path}.${key}` : key, [label, String(child.title || key)].filter(Boolean).join(' › '),
          required && Array.isArray(node.required) && node.required.includes(key), depth + 1);
      }
    } else if (path) result[path] = { title: label, type: typeof node.type === 'string' ? node.type : undefined,
      description: typeof node.description === 'string' ? node.description : undefined,
      enum: Array.isArray(node.enum) ? node.enum : undefined, required };
  };
  if (schema) visit(schema, '', '', true, 0);
  return result;
}
