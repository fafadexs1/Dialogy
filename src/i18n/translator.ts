import { defaultLocale, type Locale } from "./locales";
import ptBR from "./messages/pt-BR.json";
import enUS from "./messages/en-US.json";
import esES from "./messages/es-ES.json";

type MessageDictionary = Record<string, MessageValue>;
type MessageValue = string | MessageDictionary;

export const messagesByLocale = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": esES,
} as const satisfies Record<Locale, MessageDictionary>;

export function getMessage(messages: MessageDictionary, key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(messages, key)) {
    const direct = messages[key] as MessageValue;
    return typeof direct === "string" ? direct : undefined;
  }

  const value = key.split(".").reduce<MessageValue | undefined>((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return acc[part] as MessageValue | undefined;
  }, messages);

  return typeof value === "string" ? value : undefined;
}

export function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => {
    const current = messagesByLocale[locale] ?? messagesByLocale[defaultLocale];
    const fallback = messagesByLocale[defaultLocale];
    const message = getMessage(current, key) ?? getMessage(fallback, key);
    if (!message) return key;
    return interpolate(message, vars);
  };
}
