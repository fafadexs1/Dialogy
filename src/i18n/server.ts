import { cookies, headers } from "next/headers";
import { defaultLocale, resolveLocale, type Locale } from "./locales";
import { createTranslator } from "./translator";

const STORAGE_KEY = "dialogy-locale";

function resolveAcceptLanguage(headerValue: string | null) {
  if (!headerValue) return null;
  const languages = headerValue
    .split(",")
    .map((entry) => entry.trim().split(";")[0])
    .filter(Boolean);

  for (const language of languages) {
    const resolved = resolveLocale(language);
    if (resolved) return resolved;
  }
  return null;
}

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = resolveLocale(cookieStore.get(STORAGE_KEY)?.value);
  if (cookieLocale) return cookieLocale;

  const headerStore = await headers();
  const headerLocale = resolveAcceptLanguage(headerStore.get("accept-language"));
  if (headerLocale) return headerLocale;

  return defaultLocale;
}

export async function getServerI18n() {
  const locale = await getServerLocale();
  return {
    locale,
    t: createTranslator(locale),
  };
}
