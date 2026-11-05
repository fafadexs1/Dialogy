import { isRecord } from '@/services/workflow-runtime/utils';

/** Decode inline text/plain MIME parts, excluding attachments and bounding prompt size. */
export function extractGmailText(message: unknown): string {
  if (!isRecord(message)) return '';
  const parts: string[] = [];
  let size = 0, visited = 0;
  const visit = (part: unknown, depth: number) => {
    if (!isRecord(part) || depth > 12 || ++visited > 100 || size >= 20000) return;
    if (part.mimeType === 'text/plain' && !part.filename && isRecord(part.body) && typeof part.body.data === 'string') {
      const encoded = part.body.data;
      if (encoded.length <= 30000 && /^[A-Za-z0-9_-]*={0,2}$/.test(encoded)) {
        const text = Buffer.from(encoded, 'base64url').toString('utf8').slice(0, 20000 - size);
        parts.push(text); size += text.length;
      }
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) visit(child, depth + 1);
  };
  visit(message.payload, 0);
  return parts.join('\n\n').slice(0, 20000);
}
