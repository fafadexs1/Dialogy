/** Build a standards-compatible, plain-text Gmail reply from reviewable arguments. */
export function buildGmailReply(args: Record<string, unknown>) {
  const { to, subject, inReplyTo, threadId, text } = args;
  if (typeof to !== 'string' || to.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(to)) throw new Error('Informe um destinatário de email válido.');
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 500 || /[\r\n]/.test(subject)) throw new Error('Assunto inválido.');
  if (typeof inReplyTo !== 'string' || !/^<[^\s<>@]+@[^\s<>@]+>$/.test(inReplyTo) || inReplyTo.length > 500) throw new Error('Informe o Message-ID original entre < e >.');
  if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(threadId)) throw new Error('Identificador de conversa inválido.');
  if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('Informe o texto da resposta.');
  const parts: string[] = []; let part = '';
  for (const char of subject) { if (Buffer.byteLength(part + char, 'utf8') > 30) { parts.push(part); part = ''; } part += char; }
  if (part) parts.push(part);
  const encodedSubject = parts.map(value => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const mime = [`To: ${to}`, `Subject: ${encodedSubject}`, `In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
  return { raw: Buffer.from(mime, 'utf8').toString('base64url'), threadId };
}
