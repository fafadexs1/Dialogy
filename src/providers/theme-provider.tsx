'use client';

import * as React from 'react';

type ThemeMode = 'light' | 'dark' | 'system' | string;

export type ThemeProviderProps = {
  children: React.ReactNode;
  attribute?: string | string[];
  defaultTheme?: ThemeMode;
  storageKey?: string;
  enableSystem?: boolean;
  enableColorScheme?: boolean;
  disableTransitionOnChange?: boolean;
  forcedTheme?: ThemeMode;
  themes?: ThemeMode[];
  value?: Record<string, string>;
};

type ThemeContextValue = {
  theme?: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  forcedTheme?: ThemeMode;
  resolvedTheme?: ThemeMode;
  themes: ThemeMode[];
  systemTheme?: 'light' | 'dark';
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);
const DEFAULT_THEMES: ThemeMode[] = ['light', 'dark'];
const SYSTEM_MEDIA_QUERY = '(prefers-color-scheme: dark)';



function readStoredTheme(storageKey: string, fallback: ThemeMode) {
  if (typeof window === 'undefined') return fallback;

  try {
    return window.localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function disableTransitionsTemporarily() {
  if (typeof document === 'undefined') return () => undefined;

  const style = document.createElement('style');
  style.appendChild(
    document.createTextNode(
      '*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}'
    )
  );
  document.head.appendChild(style);

  return () => {
    window.getComputedStyle(document.body);
    window.setTimeout(() => {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 1);
  };
}

function applyThemeToDocument({
  attribute,
  resolvedTheme,
  enableColorScheme,
  themes,
  value,
}: {
  attribute: string | string[];
  resolvedTheme?: ThemeMode;
  enableColorScheme: boolean;
  themes: ThemeMode[];
  value?: Record<string, string>;
}) {
  if (typeof document === 'undefined' || !resolvedTheme) return;

  const root = document.documentElement;
  const attributes = Array.isArray(attribute) ? attribute : [attribute];

  for (const attr of attributes) {
    if (attr === 'class') {
      const classNames = themes.map((theme) => (value && value[theme] ? value[theme] : theme)).filter(Boolean);
      root.classList.remove(...classNames);
      const nextClass = value && value[resolvedTheme] ? value[resolvedTheme] : resolvedTheme;
      if (nextClass) {
        root.classList.add(nextClass);
      }
      continue;
    }

    if (resolvedTheme) {
      const nextValue = value && value[resolvedTheme] ? value[resolvedTheme] : resolvedTheme;
      root.setAttribute(attr, nextValue);
    } else {
      root.removeAttribute(attr);
    }
  }

  if (enableColorScheme) {
    const colorScheme = resolvedTheme === 'light' || resolvedTheme === 'dark' ? resolvedTheme : null;
    if (colorScheme) {
      root.style.colorScheme = colorScheme;
    } else {
      root.style.removeProperty('color-scheme');
    }
  }
}

export function ThemeProvider({
  children,
  attribute = 'data-theme',
  defaultTheme = 'system',
  storageKey = 'theme',
  enableSystem = true,
  enableColorScheme = true,
  disableTransitionOnChange = false,
  forcedTheme,
  themes = DEFAULT_THEMES,
  value,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<ThemeMode>(defaultTheme);
  const [systemTheme, setSystemTheme] = React.useState<'light' | 'dark' | undefined>(undefined);

  React.useEffect(() => {
    setThemeState(readStoredTheme(storageKey, defaultTheme));
  }, [defaultTheme, storageKey]);

  React.useEffect(() => {
    if (!enableSystem || typeof window === 'undefined') {
      setSystemTheme(undefined);
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_MEDIA_QUERY);
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    updateSystemTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateSystemTheme);
      return () => mediaQuery.removeEventListener('change', updateSystemTheme);
    }

    mediaQuery.addListener(updateSystemTheme);
    return () => mediaQuery.removeListener(updateSystemTheme);
  }, [enableSystem]);

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setThemeState(event.newValue || defaultTheme);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [defaultTheme, storageKey]);

  const activeTheme = forcedTheme ?? theme;
  const resolvedTheme =
    activeTheme === 'system' ? (enableSystem ? systemTheme ?? 'dark' : 'dark') : activeTheme;

  React.useEffect(() => {
    const cleanup = disableTransitionOnChange ? disableTransitionsTemporarily() : null;

    applyThemeToDocument({
      attribute,
      resolvedTheme,
      enableColorScheme,
      themes,
      value,
    });

    cleanup?.();
  }, [attribute, disableTransitionOnChange, enableColorScheme, resolvedTheme, themes, value]);

  const setTheme = React.useCallback(
    (nextTheme: ThemeMode) => {
      setThemeState(nextTheme);

      try {
        window.localStorage.setItem(storageKey, nextTheme);
      } catch {
        // Ignore storage failures and keep in-memory theme state.
      }
    },
    [storageKey]
  );

  const contextValue = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      forcedTheme,
      resolvedTheme,
      themes: enableSystem ? [...themes, 'system'] : themes,
      systemTheme,
    }),
    [enableSystem, forcedTheme, resolvedTheme, setTheme, systemTheme, theme, themes]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
