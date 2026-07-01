import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import type { GlobalAlertConfig } from '@/lib/system-alerts';
import { cn } from '@/lib/utils';

export function GlobalAlertBanner({ alert }: { alert: GlobalAlertConfig }) {
    if (!alert || !alert.active || !alert.message) return null;

    const colorStyles = {
        red: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-500/10",
        yellow: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400 dark:bg-yellow-500/10",
        green: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/10",
        blue: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400 dark:bg-blue-500/10",
    };

    const IconMap = {
        red: AlertCircle,
        yellow: AlertTriangle,
        green: CheckCircle2,
        blue: Info
    };
    const Icon = IconMap[alert.color] || Info;
    const hasLink = Boolean(alert.linkUrl);
    const isExternalLink = hasLink && /^https?:\/\//i.test(alert.linkUrl);

    return (
        <div className={cn("z-50 flex max-h-11 min-h-7 w-full shrink-0 items-center justify-center overflow-hidden border-b px-2 py-1 text-[11px] font-medium leading-tight sm:px-3 sm:text-xs md:text-[13px]", colorStyles[alert.color])}>
            <div className="flex min-w-0 max-w-full items-center justify-center gap-x-1.5 text-center sm:gap-x-2">
                <Icon className="h-3.5 w-3.5 shrink-0 md:h-4 md:w-4" />
                <span className="line-clamp-2 min-w-0 break-words">{alert.message}</span>
                {hasLink ? (
                    <a
                        href={alert.linkUrl}
                        target={isExternalLink ? '_blank' : undefined}
                        rel={isExternalLink ? 'noopener noreferrer' : undefined}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
                    >
                        Saiba mais
                        <ExternalLink className="h-3 w-3 shrink-0 md:h-3.5 md:w-3.5" />
                    </a>
                ) : null}
            </div>
        </div>
    );
}
