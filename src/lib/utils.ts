import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format as formatDate, formatDistanceToNow, isSameDay, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMessageDate(date: Date, timezone: string): string {
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const zonedDate = toZonedTime(date, timezone);
  const zonedNow = toZonedTime(new Date(), timezone);

  if (isSameDay(zonedDate, zonedNow)) {
    return `Hoje`;
  }
  if (isSameDay(zonedDate, subDays(zonedNow, 1))) {
    return `Ontem`;
  }
  return formatDate(zonedDate, "dd/MM/yyyy", { locale: ptBR });
}

export function formatMessageTime(date: Date | string, timezone: string = 'America/Sao_Paulo'): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) {
      return typeof date === 'string' ? date : '';
    }

    const zonedDate = toZonedTime(d, timezone);
    const zonedNow = toZonedTime(new Date(), timezone);

    if (isSameDay(zonedDate, zonedNow)) {
      return formatDate(zonedDate, "HH:mm");
    }

    return formatDistanceToNow(zonedDate, { addSuffix: true, locale: ptBR });
  } catch (e) {
    return typeof date === 'string' ? date : '';
  }
}

export function buildChatProtocol(chatId: string): string {
  if (!chatId) return '';
  const cleaned = chatId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return cleaned ? `PRT-${cleaned}` : '';
}

export function formatWhatsappText(text: string, options: { isOutgoing?: boolean } = {}): string {
  if (!text) return '';

  // URL regex to find links
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const { isOutgoing } = options;

  // First, escape HTML to prevent XSS from other content
  let processedText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Then, apply rich text formatting for whatsapp-style markdown
  // Note: Lookbehind support varies, so we use a more compatible approach
  processedText = processedText
    .replace(/(\s|^)\*(.*?)\*(?=\s|$|[.,:;!?])/g, '$1<b>$2</b>') // Bold
    .replace(/(\s|^)_(.*?)_(?=\s|$|[.,:;!?])/g, '$1<i>$2</i>') // Italic
    .replace(/(\s|^)~(.*?)~(?=\s|$|[.,:;!?])/g, '$1<s>$2</s>') // Strikethrough
    .replace(/```([\s\S]*?)```/g, (match, p1) => `<pre><code>${p1}</code></pre>`); // Code block

  // Finally, replace URLs with anchor tags
  processedText = processedText.replace(urlRegex, (url) => {
    // The URL is already escaped, so we can safely use it.
    // We need to decode it for the href attribute but keep the display version escaped.
    const decodedUrl = url.replace(/&amp;/g, "&");
    const outgoingClasses = 'text-white/90 underline decoration-white/60 hover:decoration-white';
    const incomingClasses = 'text-blue-400 hover:text-blue-300 underline';
    return `<a href="${decodedUrl}" target="_blank" rel="noopener noreferrer" class="${isOutgoing ? outgoingClasses : incomingClasses}">${url}</a>`;
  });

  return processedText.replace(/\n/g, '<br />'); // Handle line breaks
}

export function sanitizeUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return null;

  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch (e) {
    return trimmedUrl;
  }
}
