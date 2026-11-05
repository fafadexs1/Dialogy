'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    BookOpen,
    Check,
    ChevronDown,
    CornerDownLeft,
    Pencil,
    RefreshCw,
    Sparkles,
    Target,
    Wrench,
    X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    describeCopilotIntent,
    describeCopilotSuggestionStage,
    type CopilotSuggestionInsights,
} from '@/lib/copilot-suggestion-types';

export type CopilotSuggestionView = {
    id: string | null;
    agentName: string;
    text: string;
    blocks: string[];
    stage: string;
    insights: CopilotSuggestionInsights;
    createdAt: string;
};

type CopilotSuggestionCardProps = {
    suggestion: CopilotSuggestionView | null;
    isThinking: boolean;
    agentName: string;
    agentAvatarUrl?: string | null;
    canRequest: boolean;
    onSend: (text: string) => void;
    onEdit: (text: string) => void;
    onRegenerate: () => void;
    onDismiss: () => void;
};

const THINKING_STEPS = [
    'Lendo a conversa',
    'Buscando na base de conhecimento',
    'Consultando os sistemas',
    'Escrevendo a resposta',
];

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'IA';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function confidenceTone(confidence: number): { label: string; className: string } {
    if (confidence >= 0.75) {
        return { label: 'Alta confiança', className: 'text-emerald-600 dark:text-emerald-400' };
    }
    if (confidence >= 0.45) {
        return { label: 'Confiança média', className: 'text-amber-600 dark:text-amber-400' };
    }
    return { label: 'Baixa confiança', className: 'text-rose-600 dark:text-rose-400' };
}

function AgentAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
    if (avatarUrl) {
        return (
            <img
                src={avatarUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-cyan-400/30"
            />
        );
    }
    return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-[11px] font-semibold text-white ring-2 ring-cyan-400/25">
            {initialsOf(name)}
        </div>
    );
}

function ThinkingState({ agentName, agentAvatarUrl }: { agentName: string; agentAvatarUrl?: string | null }) {
    const [stepIndex, setStepIndex] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setStepIndex((current) => (current + 1) % THINKING_STEPS.length);
        }, 1600);
        return () => window.clearInterval(timer);
    }, []);

    return (
        <div
            className="mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
            aria-live="polite"
        >
            <div className="relative overflow-hidden rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-50/90 to-white p-3.5 dark:border-cyan-400/20 dark:from-cyan-950/30 dark:to-black/40">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-px animate-pulse bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
                <div className="flex items-center gap-3">
                    <AgentAvatar name={agentName} avatarUrl={agentAvatarUrl} />
                    <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-900 dark:text-white">
                            {agentName} está preparando uma resposta
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cyan-700 dark:text-cyan-300">
                            <span className="flex gap-1">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 [animation-delay:-0.3s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 [animation-delay:-0.15s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500" />
                            </span>
                            {THINKING_STEPS[stepIndex]}…
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function InsightChips({ insights }: { insights: CopilotSuggestionInsights }) {
    const intentLabel = describeCopilotIntent(insights.intent);
    const confidence = typeof insights.intentConfidence === 'number' ? insights.intentConfidence : null;
    const tone = confidence !== null ? confidenceTone(confidence) : null;
    const sources = insights.knowledgeSources || [];
    const tools = insights.toolsUsed || [];

    if (!intentLabel && sources.length === 0 && tools.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {intentLabel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-zinc-300">
                    <Target className="h-3 w-3" />
                    {intentLabel}
                    {tone && (
                        <span className={cn('font-semibold', tone.className)}>
                            · {Math.round((confidence as number) * 100)}%
                        </span>
                    )}
                </span>
            )}
            {sources.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-zinc-300">
                    <BookOpen className="h-3 w-3" />
                    {sources.length === 1 ? '1 fonte consultada' : `${sources.length} fontes consultadas`}
                </span>
            )}
            {tools.map((tool) => (
                <span
                    key={tool.name}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        tool.status === 'error'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
                    )}
                >
                    {tool.status === 'error' ? <AlertTriangle className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                    {tool.displayName || tool.name}
                </span>
            ))}
        </div>
    );
}

function ReasoningDetails({ insights, stage }: { insights: CopilotSuggestionInsights; stage: string }) {
    const [open, setOpen] = useState(false);
    const sources = insights.knowledgeSources || [];
    const hasDetail = sources.length > 0 || Boolean(insights.model) || Boolean(insights.ragStrategy) || Boolean(insights.summary);

    if (!hasDetail) return null;

    return (
        <div className="mt-2.5 border-t border-slate-200/70 pt-2 dark:border-white/10">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white"
                aria-expanded={open}
            >
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                Como cheguei nesta resposta
            </button>
            {open && (
                <div className="mt-2 space-y-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
                    {insights.summary && <p><span className="font-medium">Contexto:</span> {insights.summary}</p>}
                    {!!insights.missingInformation?.length && <p><span className="font-medium">Falta confirmar:</span> {insights.missingInformation.join(' · ')}</p>}
                    {!!insights.cautions?.length && <ul className="space-y-1 text-amber-700 dark:text-amber-300">{insights.cautions.map((caution, index) => <li key={index}>{caution}</li>)}</ul>}
                    {!!insights.recommendedActions?.length && <div>
                        <p className="font-medium">Próximos passos para você</p>
                        <ul className="mt-1 space-y-1">{insights.recommendedActions.map((action, index) => <li key={index}>{action.label}{action.reason ? ` — ${action.reason}` : ''}</li>)}</ul>
                    </div>}
                    <p>
                        <span className="font-medium text-slate-700 dark:text-zinc-200">Origem:</span>{' '}
                        {describeCopilotSuggestionStage(stage)}
                    </p>
                    {sources.length > 0 && (
                        <div>
                            <span className="font-medium text-slate-700 dark:text-zinc-200">Base consultada:</span>
                            <ul className="mt-1 space-y-0.5">
                                {sources.map((source, index) => (
                                    <li key={`${source.id || source.name}-${index}`} className="flex items-start gap-1.5">
                                        <BookOpen className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                                        <span className="min-w-0 break-words">{source.name}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {insights.model && (
                        <p>
                            <span className="font-medium text-slate-700 dark:text-zinc-200">Modelo:</span> {insights.model}
                            {typeof insights.latencyMs === 'number' && (
                                <span className="opacity-70"> · {(insights.latencyMs / 1000).toFixed(1)}s</span>
                            )}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * The copilot draft, shown exactly as the customer would receive it: one bubble per
 * WhatsApp message, with the reasoning that produced it and one-key actions.
 */
export function CopilotSuggestionCard({
    suggestion,
    isThinking,
    agentName,
    agentAvatarUrl,
    canRequest,
    onSend,
    onEdit,
    onRegenerate,
    onDismiss,
}: CopilotSuggestionCardProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const blocks = useMemo(() => {
        if (!suggestion) return [];
        const normalized = suggestion.blocks.filter((block) => block.trim().length > 0);
        return normalized.length > 0 ? normalized : [suggestion.text];
    }, [suggestion]);

    // Keyboard shortcuts work while the operator is typing in the composer, which is
    // where their hands already are when a draft lands.
    useEffect(() => {
        if (!suggestion) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                onSend(suggestion.text);
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
                event.preventDefault();
                onEdit(suggestion.text);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [suggestion, onSend, onEdit]);

    if (isThinking && !suggestion) {
        return <ThinkingState agentName={agentName} agentAvatarUrl={agentAvatarUrl} />;
    }

    if (!suggestion) {
        // The copilot is on but has nothing pending — keep it visible and one click away.
        return (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500 dark:text-zinc-400">
                    <span className="font-medium text-slate-700 dark:text-zinc-200">{agentName}</span>
                    {' '}acompanha esta conversa e sugere respostas
                </p>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-cyan-700 hover:text-cyan-800 dark:text-cyan-300"
                    disabled={!canRequest}
                    onClick={onRegenerate}
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sugerir resposta
                </Button>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
            role="region"
            aria-label={`Sugestão de resposta de ${suggestion.agentName}`}
        >
            <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-white shadow-[0_18px_45px_-32px_rgba(8,145,178,0.65)] dark:border-cyan-400/20 dark:bg-white/[0.03]">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />

                <div className="flex items-start gap-3 px-3.5 pt-3">
                    <AgentAvatar name={suggestion.agentName} avatarUrl={agentAvatarUrl} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
                            <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                                {suggestion.agentName}
                            </p>
                            <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                                sugestão
                            </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                            {describeCopilotSuggestionStage(suggestion.stage)}
                            {blocks.length > 1 && ` · ${blocks.length} mensagens`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Descartar sugestão"
                        className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="mt-2.5 space-y-1.5 px-3.5">
                    {blocks.map((block, index) => (
                        <div
                            key={`${index}-${block.slice(0, 12)}`}
                            className="relative rounded-xl rounded-tr-sm bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-800 dark:bg-white/[0.05] dark:text-zinc-100"
                        >
                            <p className="whitespace-pre-wrap break-words">{block}</p>
                            {blocks.length > 1 && (
                                <span className="absolute -top-1.5 right-2 rounded-full bg-slate-200 px-1.5 text-[9px] font-medium text-slate-600 dark:bg-white/10 dark:text-zinc-300">
                                    {index + 1}/{blocks.length}
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                <div className="px-3.5 pt-2.5">
                    <InsightChips insights={suggestion.insights} />
                    <ReasoningDetails insights={suggestion.insights} stage={suggestion.stage} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 bg-slate-50/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.02]">
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 bg-cyan-600 px-3 text-white hover:bg-cyan-700"
                        onClick={() => onSend(suggestion.text)}
                    >
                        <Check className="h-4 w-4" />
                        Enviar
                        <kbd className="ml-0.5 hidden rounded bg-white/20 px-1 text-[9px] font-medium sm:inline">
                            ⌘⏎
                        </kbd>
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-3"
                        onClick={() => onEdit(suggestion.text)}
                    >
                        <Pencil className="h-4 w-4" />
                        Editar
                        <kbd className="ml-0.5 hidden rounded bg-slate-200 px-1 text-[9px] font-medium text-slate-600 dark:bg-white/10 dark:text-zinc-300 sm:inline">
                            ⌘J
                        </kbd>
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2.5 text-slate-600 dark:text-zinc-300"
                        disabled={!canRequest || isThinking}
                        onClick={onRegenerate}
                    >
                        <RefreshCw className={cn('h-4 w-4', isThinking && 'animate-spin')} />
                        Refazer
                    </Button>
                    <span className="ml-auto hidden items-center gap-1 text-[10px] text-slate-400 dark:text-zinc-500 md:flex">
                        <CornerDownLeft className="h-3 w-3" />
                        Nada é enviado sem você
                    </span>
                </div>
            </div>
        </div>
    );
}
