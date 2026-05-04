export function normalizeMcpToolArguments(rawArguments: unknown):
  | { success: true; arguments: Record<string, unknown> }
  | { success: false; error: string } {
  if (rawArguments == null) {
    return { success: true, arguments: {} };
  }

  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { success: false, error: 'Argumentos MCP devem ser um objeto JSON, nao uma string.' };
      }
      return { success: true, arguments: parsed as Record<string, unknown> };
    } catch {
      return { success: false, error: 'Argumentos MCP em string devem ser JSON valido.' };
    }
  }

  if (typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return { success: true, arguments: rawArguments as Record<string, unknown> };
  }

  return { success: false, error: 'Argumentos MCP devem ser um objeto JSON.' };
}
