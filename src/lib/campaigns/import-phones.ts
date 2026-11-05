import { findPhoneNumbersInText } from 'libphonenumber-js/min';

/** Extract complete numbers separately. Never concatenate two phones or invent a missing DDD. */
export function normalizeCampaignPhoneNumbers(value: string): string[] {
  const text = String(value || '').trim()
    .replace(/@(s\.whatsapp\.net|c\.us)\b/gi, '')
    .replace(/(^|[^\d])00(?=[1-9]\d)/g, '$1+')
    .replace(/(^|[^\d+])([1-9]\d)[ \t]+(?=\d{4,5}[ .-]?\d{4,5}(?:\D|$))/g, '$1($2) ');
  if (!text || /^\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(text)) return [];
  // Existing CSVs can already contain an E.164 number without the leading '+'.
  const searchable = /^[1-9]\d{11,14}$/.test(text) ? `+${text}` : text;
  const numbers = findPhoneNumbersInText(searchable, 'BR')
    .filter(({ number }) => {
      const digits = number.number.slice(1);
      if (!/^[1-9]\d{7,14}$/.test(digits)) return false;
      // Require a DDD. Preserve legacy eight-digit mobiles for the existing
      // Evolution identity/alias resolution at the provider boundary.
      if (number.countryCallingCode === '55') {
        return /^[1-9]\d[2-9]\d{7,8}$/.test(String(number.nationalNumber));
      }
      return number.isPossible();
    })
    .map(({ number }) => number.number.slice(1));
  return [...new Set(numbers)];
}
