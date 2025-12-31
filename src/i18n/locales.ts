export const locales = ["pt-BR", "en-US", "es-ES"] as const;
export type Locale = typeof locales[number];

export type FlagCode = "BR" | "US" | "ES";

export type LocaleOption = {
  locale: Locale;
  label: string;
  nativeLabel: string;
  shortLabel: string;
  flag: FlagCode;
};

export const defaultLocale: Locale = "pt-BR";

export const localeOptions: LocaleOption[] = [
  {
    locale: "pt-BR",
    label: "Portuguese (Brazil)",
    nativeLabel: "Portugues (Brasil)",
    shortLabel: "PT-BR",
    flag: "BR",
  },
  {
    locale: "en-US",
    label: "English (US)",
    nativeLabel: "English (US)",
    shortLabel: "EN-US",
    flag: "US",
  },
  {
    locale: "es-ES",
    label: "Spanish (Spain)",
    nativeLabel: "Espanol (Espanha)",
    shortLabel: "ES-ES",
    flag: "ES",
  },
];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function resolveLocale(value?: string | null): Locale | null {
  if (!value) return null;
  const normalized = value.replace("_", "-").toLowerCase();
  const exact = localeOptions.find(
    (option) => option.locale.toLowerCase() === normalized
  );
  if (exact) return exact.locale;
  const base = normalized.split("-")[0];
  const partial = localeOptions.find((option) =>
    option.locale.toLowerCase().startsWith(`${base}-`)
  );
  return partial ? partial.locale : null;
}
