'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AudioLines,
    CircleAlert,
    Languages,
    Loader2,
    Pause,
    Play,
    RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toAbsoluteAppUrl } from '@/lib/storage-url';
import { useToast } from '@/hooks/use-toast';
import { useInboxStore } from '@/hooks/use-inbox-store';
import type { AudioTranscriptionJob } from '@/hooks/inbox-store/types';
import { hasPendingAudioTranscription, transcribeAudioInBackground } from '@/services/audio/transcription-client';

interface AudioPlayerProps {
    src: string;
    messageId?: string;
    initialTranscription?: string | null;
    duration?: number;
    waveform?: number[];
    isFromMe?: boolean;
    workspaceId: string;
    chatId?: string;
}

type PlaybackRate = 1 | 1.5 | 2;

const PLAYBACK_RATES: PlaybackRate[] = [1, 1.5, 2];
const WAVEFORM_BAR_COUNT = 44;

const formatTime = (timeInSeconds: number) => {
    if (!Number.isFinite(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cleanTranscription(value?: string | null) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
}

function createFallbackWaveform(source: string, count: number) {
    let seed = 2166136261;

    for (let index = 0; index < source.length; index += 1) {
        seed ^= source.charCodeAt(index);
        seed = Math.imul(seed, 16777619);
    }

    return Array.from({ length: count }, (_, index) => {
        seed = Math.imul(seed ^ (index + 1), 16777619);
        const normalized = ((seed >>> 0) % 1000) / 1000;
        return 0.26 + normalized * 0.68;
    });
}

function normalizeWaveform(values: number[] | undefined, source: string) {
    const safeValues = (values || []).filter((value) => Number.isFinite(value));
    if (safeValues.length === 0) return createFallbackWaveform(source, WAVEFORM_BAR_COUNT);

    const minimum = Math.min(...safeValues);
    const maximum = Math.max(...safeValues);
    const range = maximum - minimum;

    return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const start = Math.floor((index * safeValues.length) / WAVEFORM_BAR_COUNT);
        const end = Math.max(start + 1, Math.ceil(((index + 1) * safeValues.length) / WAVEFORM_BAR_COUNT));
        const sample = safeValues.slice(start, end);
        const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;
        const normalized = range > 0 ? (average - minimum) / range : 0.62;
        return 0.24 + clamp(normalized, 0, 1) * 0.72;
    });
}

export function AudioPlayer({
    src,
    messageId,
    initialTranscription,
    duration: initialDuration,
    waveform,
    isFromMe,
    workspaceId,
    chatId,
}: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const durationProbeStateRef = useRef<'idle' | 'probing' | 'done'>('idle');
    const transcriptionRequestRef = useRef(0);
    const { toast } = useToast();

    const updateMessage = useInboxStore((state) => state.updateMessage);
    const setAudioTranscription = useInboxStore((state) => state.setAudioTranscription);
    const storedTranscriptionJob = useInboxStore((state) => (
        messageId ? state.audioTranscriptions[messageId] : undefined
    ));

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(
        initialDuration && Number.isFinite(initialDuration) ? initialDuration : 0
    );
    const [localTranscription, setLocalTranscription] = useState(() => cleanTranscription(initialTranscription));
    const [localTranscriptionJob, setLocalTranscriptionJob] = useState<AudioTranscriptionJob | undefined>();
    const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);

    const transcriptionJob = messageId ? storedTranscriptionJob : localTranscriptionJob;
    const transcription = cleanTranscription(transcriptionJob?.transcription)
        || localTranscription
        || cleanTranscription(initialTranscription);
    const isTranscribing = transcriptionJob?.status === 'transcribing' && !transcription;
    const transcriptionError = transcriptionJob?.status === 'error' ? transcriptionJob.error : null;

    const waveformBars = useMemo(
        () => normalizeWaveform(waveform, src),
        [src, waveform]
    );

    const setTranscriptionJob = useCallback((job: AudioTranscriptionJob | null) => {
        if (messageId) {
            setAudioTranscription(messageId, job);
        } else {
            setLocalTranscriptionJob(job || undefined);
        }
    }, [messageId, setAudioTranscription]);

    useEffect(() => {
        const nextTranscription = cleanTranscription(initialTranscription);
        if (nextTranscription) setLocalTranscription(nextTranscription);
    }, [initialTranscription]);

    useEffect(() => {
        const savedRate = window.localStorage.getItem('audioPlaybackRate');
        const parsedRate = Number(savedRate) as PlaybackRate;
        if (PLAYBACK_RATES.includes(parsedRate)) setPlaybackRate(parsedRate);
    }, []);

    useEffect(() => {
        if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    }, [playbackRate]);

    useEffect(() => {
        durationProbeStateRef.current = 'idle';
        setCurrentTime(0);
        setDuration(initialDuration && Number.isFinite(initialDuration) ? initialDuration : 0);
    }, [src, initialDuration]);

    const handleTimeUpdate = useCallback(() => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    }, []);

    const handleLoadedMetadata = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;

        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            durationProbeStateRef.current = 'done';
            setDuration(audio.duration);
            return;
        }

        if (durationProbeStateRef.current === 'idle') {
            durationProbeStateRef.current = 'probing';
            try {
                audio.currentTime = 1e101;
            } catch {
                durationProbeStateRef.current = 'done';
            }
        }
    }, []);

    const handleDurationChange = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

        setDuration(audio.duration);
        if (durationProbeStateRef.current === 'probing') {
            durationProbeStateRef.current = 'done';
            try {
                audio.currentTime = 0;
                setCurrentTime(0);
            } catch {
                // The browser can reject the rewind while the media is still loading.
            }
        }
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('durationchange', handleDurationChange);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', handleEnded);

        if (audio.readyState > 0) handleLoadedMetadata();

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('durationchange', handleDurationChange);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [handleDurationChange, handleLoadedMetadata, handleTimeUpdate]);

    const handlePlayPause = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;

        if (audio.paused) {
            try {
                await audio.play();
            } catch {
                setIsPlaying(false);
                toast({
                    title: 'Não foi possível reproduzir o áudio',
                    description: 'Verifique se o arquivo ainda está disponível.',
                    variant: 'destructive',
                });
            }
        } else {
            audio.pause();
        }
    };

    const seekTo = useCallback((nextTime: number) => {
        if (!audioRef.current || !Number.isFinite(duration) || duration <= 0) return;
        const clampedTime = clamp(nextTime, 0, duration);
        audioRef.current.currentTime = clampedTime;
        setCurrentTime(clampedTime);
    }, [duration]);

    const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!progressRef.current || duration <= 0) return;
        const rect = progressRef.current.getBoundingClientRect();
        const percentage = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        seekTo(percentage * duration);
    };

    const handleSeekKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!duration) return;
        const step = Math.max(1, duration / 20);

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            seekTo(currentTime - step);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            seekTo(currentTime + step);
        } else if (event.key === 'Home') {
            event.preventDefault();
            seekTo(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            seekTo(duration);
        }
    };

    const togglePlaybackRate = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
        const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
        setPlaybackRate(nextRate);
        window.localStorage.setItem('audioPlaybackRate', nextRate.toString());
    };

    const handleTranscribe = useCallback(async () => {
        if (isTranscribing || transcription) return;

        const audioUrl = toAbsoluteAppUrl(src);
        if (!audioUrl) {
            toast({
                title: 'Não foi possível transcrever',
                description: 'URL do áudio não encontrada.',
                variant: 'destructive',
            });
            return;
        }

        const requestId = transcriptionRequestRef.current + 1;
        transcriptionRequestRef.current = requestId;
        setTranscriptionJob({ status: 'transcribing', transcription: null, error: null });

        try {
            const nextTranscription = await transcribeAudioInBackground({ audioUrl, workspaceId, messageId, chatId });
            if (!nextTranscription) {
                throw new Error('A transcrição retornou vazia. Tente novamente.');
            }

            if (requestId !== transcriptionRequestRef.current) return;

            setTranscriptionJob({ status: 'completed', transcription: nextTranscription, error: null });
            setLocalTranscription(nextTranscription);
            if (chatId && messageId) {
                updateMessage(chatId, messageId, { transcription: nextTranscription });
            }
        } catch (error) {
            if (requestId !== transcriptionRequestRef.current) return;
            const message = error instanceof Error ? error.message : 'Não foi possível transcrever o áudio.';
            setTranscriptionJob({ status: 'error', transcription: null, error: message });
            toast({ title: 'Erro ao transcrever', description: message, variant: 'destructive' });
        }
    }, [isTranscribing, transcription, src, toast, setTranscriptionJob, workspaceId, messageId, chatId, updateMessage]);

    useEffect(() => {
        const audioUrl = toAbsoluteAppUrl(src);
        if (!isFromMe && !transcription && !isTranscribing && !transcriptionError && audioUrl
            && hasPendingAudioTranscription({ audioUrl, workspaceId, messageId, chatId })) {
            void handleTranscribe();
        }
    }, [src, workspaceId, messageId, chatId, isFromMe, transcription, isTranscribing, transcriptionError, handleTranscribe]);

    const progressPercentage = duration > 0
        ? clamp((currentTime / duration) * 100, 0, 100)
        : 0;

    const shellClasses = isFromMe
        ? 'border-blue-500/25 bg-blue-600 text-white shadow-blue-950/15'
        : 'border-slate-200/90 bg-slate-50/90 text-slate-900 shadow-slate-900/5 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100';
    const secondaryTextClasses = isFromMe
        ? 'text-white/60'
        : 'text-slate-500 dark:text-zinc-500';
    const baseBarClasses = isFromMe
        ? 'bg-white/25'
        : 'bg-slate-300 dark:bg-white/15';
    const playedBarClasses = isFromMe ? 'bg-white' : 'bg-blue-600 dark:bg-blue-400';
    const dividerClasses = isFromMe ? 'border-white/10' : 'border-slate-200/80 dark:border-white/10';

    return (
        <div className={cn(
            'w-[min(100%,360px)] max-w-full min-w-0 overflow-hidden rounded-2xl border shadow-sm',
            shellClasses,
        )}>
            <audio ref={audioRef} src={src} preload="metadata" aria-label="Mensagem de voz" />

            <div className="flex items-center gap-3 p-3">
                <button
                    type="button"
                    onClick={handlePlayPause}
                    className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2',
                        isFromMe
                            ? 'bg-white text-blue-700 focus-visible:ring-offset-blue-600'
                            : 'bg-blue-600 text-white focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-[#111318]',
                    )}
                    aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
                >
                    {isPlaying
                        ? <Pause className="h-4 w-4 fill-current" />
                        : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                </button>

                <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold tracking-[0.01em]">
                            <AudioLines className="h-3.5 w-3.5 shrink-0 opacity-75" />
                            Mensagem de voz
                        </span>
                        <span className={cn('shrink-0 text-[10px] font-medium tabular-nums', secondaryTextClasses)}>
                            {duration > 0 ? formatTime(duration) : '—:—'}
                        </span>
                    </div>

                    <div
                        ref={progressRef}
                        role="slider"
                        tabIndex={0}
                        aria-label="Posição do áudio"
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        aria-valuenow={Math.min(currentTime, duration)}
                        aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
                        onClick={handleSeek}
                        onKeyDown={handleSeekKeyDown}
                        className="group relative flex h-8 cursor-pointer items-center gap-[3px] rounded-md px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    >
                        {waveformBars.map((barHeight, index) => {
                            const barPosition = (index / waveformBars.length) * 100;
                            const isPlayed = barPosition <= progressPercentage;
                            return (
                                <span
                                    key={`${src}-bar-${index}`}
                                    className={cn(
                                        'w-1 flex-1 rounded-full transition-[height,background-color,opacity] duration-150',
                                        isPlayed ? playedBarClasses : baseBarClasses,
                                    )}
                                    style={{
                                        height: `${Math.max(22, barHeight * 100)}%`,
                                        opacity: isPlayed ? 1 : 0.78,
                                    }}
                                />
                            );
                        })}
                        <span
                            className={cn(
                                'pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm transition-[left] duration-100',
                                isFromMe ? 'border-blue-600 bg-white' : 'border-white bg-blue-600 dark:border-[#111318] dark:bg-blue-400',
                            )}
                            style={{ left: `${progressPercentage}%` }}
                        />
                    </div>

                    <div className={cn('mt-0.5 flex justify-between text-[10px] font-medium tabular-nums', secondaryTextClasses)}>
                        <span>{formatTime(currentTime)}</span>
                        <span>{duration > 0 ? formatTime(duration) : 'Carregando'}</span>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={togglePlaybackRate}
                    className={cn(
                        'h-7 min-w-[38px] shrink-0 rounded-full border px-2 text-[10px] font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                        isFromMe
                            ? 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15',
                    )}
                    aria-label={`Velocidade ${playbackRate}x. Alterar velocidade`}
                >
                    {playbackRate}x
                </button>
            </div>

            {!isFromMe && (
                <div className={cn('border-t px-3 py-2.5', dividerClasses)}>
                    {transcription ? (
                        <div className="space-y-1.5">
                            <div className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]', secondaryTextClasses)}>
                                <Languages className="h-3 w-3" />
                                Transcrição
                            </div>
                            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-current opacity-90 [overflow-wrap:anywhere]">
                                {transcription}
                            </p>
                        </div>
                    ) : isTranscribing ? (
                        <div className="flex items-center gap-2.5" role="status" aria-live="polite">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold">Transcrevendo áudio</p>
                                <p className={cn('text-[10px]', secondaryTextClasses)}>Você pode iniciar outras transcrições.</p>
                            </div>
                        </div>
                    ) : transcriptionError ? (
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-red-600 dark:text-red-300">
                                <CircleAlert className="h-4 w-4 shrink-0" />
                                <p className="truncate text-[11px]" title={transcriptionError}>{transcriptionError}</p>
                            </div>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleTranscribe();
                                }}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-white/10 dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/15"
                            >
                                <RotateCcw className="h-3 w-3" />
                                Tentar novamente
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200/70 text-slate-500 dark:bg-white/10 dark:text-zinc-400">
                                    <Languages className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold">Transcrição disponível</p>
                                    <p className={cn('text-[10px]', secondaryTextClasses)}>Converta o áudio em texto.</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleTranscribe();
                                }}
                                disabled={isTranscribing}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-[10px] font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-wait disabled:opacity-60"
                            >
                                <Languages className="h-3 w-3" />
                                Transcrever
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
