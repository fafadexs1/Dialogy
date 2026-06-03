const SENSITIVE_KEY_PATTERN = /(authorization|token|secret|password|senha|credential|cpf|cnpj|document|email|phone|telefone|whatsapp|pix|barcode|digitable|address|endereco|ip(?:v4|v6)?|login)/i;

function redactText(value: string) {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email-redacted]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf-redacted]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj-redacted]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[phone-redacted]');
}

export function redactSensitiveLogValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveLogValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([nestedKey, nestedValue]) => [nestedKey, redactSensitiveLogValue(nestedValue, nestedKey)]),
  );
}

export function redactSensitiveLogText(value: string) {
  return String(redactSensitiveLogValue(value));
}
