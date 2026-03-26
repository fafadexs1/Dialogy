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
        <div className={cn("flex w-full items-center justify-center border-b px-4 py-2.5 text-sm font-medium z-50 shrink-0", colorStyles[alert.color])}>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="break-words">{alert.message}</span>
                {hasLink ? (
                    <a
                        href={alert.linkUrl}
                        target={isExternalLink ? '_blank' : undefined}
                        rel={isExternalLink ? 'noopener noreferrer' : undefined}
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
                    >
                        Saiba mais
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                ) : null}
            </div>
        </div>
    );
}
