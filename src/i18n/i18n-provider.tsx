"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { defaultLocale, localeOptions, resolveLocale, type Locale } from "./locales";
import { createTranslator } from "./translator";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  availableLocales: typeof localeOptions;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = "dialogy-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function persistLocale(nextLocale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${STORAGE_KEY}=${nextLocale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? defaultLocale);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    let nextLocale = resolveLocale(stored);

    if (!nextLocale && typeof navigator !== "undefined") {
      const languages = navigator.languages ?? [navigator.language];
      for (const language of languages) {
        const resolved = resolveLocale(language);
        if (resolved) {
          nextLocale = resolved;
          break;
        }
      }
    }

    if (!nextLocale) {
      nextLocale = initialLocale ?? defaultLocale;
    }

    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    document.documentElement.lang = nextLocale;
    persistLocale(nextLocale);
  }, [initialLocale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState((current) => (current === nextLocale ? current : nextLocale));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = nextLocale;
      persistLocale(nextLocale);
    }
    if (typeof window !== "undefined" && nextLocale !== locale) {
      window.location.reload();
    }
  }, [locale]);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      availableLocales: localeOptions,
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
