import type { Locale as DateFnsLocale } from "date-fns";
import { enUS, es, ptBR } from "date-fns/locale";
import type { Locale } from "./locales";

export const dateLocaleMap: Record<Locale, DateFnsLocale> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": es,
};

export function getDateLocale(locale: Locale): DateFnsLocale {
  return dateLocaleMap[locale] ?? ptBR;
}
