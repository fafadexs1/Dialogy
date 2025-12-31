"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/i18n-provider";
import { type FlagCode } from "@/i18n/locales";
import { cn } from "@/lib/utils";

function FlagIcon({ code, className }: { code: FlagCode; className?: string }) {
  if (code === "BR") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 16"
        className={cn("h-4 w-6", className)}
        role="img"
      >
        <rect width="24" height="16" rx="2" fill="#1f8f4f" />
        <polygon points="12 2 22 8 12 14 2 8" fill="#f7d038" />
        <circle cx="12" cy="8" r="3.5" fill="#1b3c8a" />
        <path d="M8.5 8.2c2.1-1.4 4.9-1.4 7 0" stroke="#ffffff" strokeWidth="1" fill="none" />
      </svg>
    );
  }

  if (code === "US") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 16"
        className={cn("h-4 w-6", className)}
        role="img"
      >
        <rect width="24" height="16" rx="2" fill="#ffffff" />
        <rect y="0" width="24" height="2" fill="#b22234" />
        <rect y="4" width="24" height="2" fill="#b22234" />
        <rect y="8" width="24" height="2" fill="#b22234" />
        <rect y="12" width="24" height="2" fill="#b22234" />
        <rect width="10" height="7" fill="#3c3b6e" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 16"
      className={cn("h-4 w-6", className)}
      role="img"
    >
      <rect width="24" height="16" rx="2" fill="#c60b1e" />
      <rect y="4" width="24" height="8" fill="#ffc400" />
    </svg>
  );
}

export function LanguageToggle() {
  const { locale, setLocale, availableLocales, t } = useI18n();
  const activeLocale =
    availableLocales.find((option) => option.locale === locale) ??
    availableLocales[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative h-9 w-9 border-border bg-white/70 text-foreground hover:bg-muted dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          aria-label={t("language.switcher")}
        >
          <FlagIcon code={activeLocale.flag} className="rounded-sm shadow-sm" />
          <span className="sr-only">{t("language.switcher")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="center" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("language.label")}
        </DropdownMenuLabel>
        <div className="px-2 pb-2 text-xs text-muted-foreground">
          {t("language.description")}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            const next = availableLocales.find(
              (option) => option.locale === value
            );
            if (next) {
              setLocale(next.locale);
            }
          }}
        >
          {availableLocales.map((option) => (
            <DropdownMenuRadioItem
              key={option.locale}
              value={option.locale}
              className="gap-2"
            >
              <FlagIcon code={option.flag} className="rounded-sm" />
              <span className="flex-1">{option.nativeLabel}</span>
              <DropdownMenuShortcut>{option.shortLabel}</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
