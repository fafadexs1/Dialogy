'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Loader2, Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { transcribeAudio } from '@/ai/flows/transcribe-audio';
import { useToast } from '@/hooks/use-toast';
import { saveTranscriptionAction } from '@/actions/messages';
import type { Message } from '@/lib/types';

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

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

import { useInboxStore } from '@/hooks/use-inbox-store';

export function AudioPlayer({ src, messageId, initialTranscription, duration: initialDuration, isFromMe, workspaceId, chatId }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const updateMessage = useInboxStore((state) => state.updateMessage);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(initialDuration || 0);
    const [transcription, setTranscription] = useState<string | null>(initialTranscription || null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    // Sync state with prop if it updates (e.g. from other user)
    useEffect(() => {
        if (initialTranscription) {
            setTranscription(initialTranscription);
        }
    }, [initialTranscription]);

    // ... (keep existing useEffects)

    // Apply playback rate to audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    const togglePlaybackRate = (e: React.MouseEvent) => {
        e.stopPropagation();
        const rates = [1, 1.5, 2];
        const nextRateIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
        const newRate = rates[nextRateIndex];
        setPlaybackRate(newRate);
        localStorage.setItem('audioPlaybackRate', newRate.toString());
    };

    const simulatedWaveform = React.useMemo(() =>
        Array.from({ length: 40 }, () => Math.random() * 0.6 + 0.3) // Fewer bars, taller minimum
        , []);

    const handlePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPlaying) {
            audioRef.current?.pause();
        } else {
            audioRef.current?.play().catch(error => console.error("Error playing audio:", error));
        }
        setIsPlaying(!isPlaying);
    };

    const handleTimeUpdate = useCallback(() => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    }, []);

    const handleLoadedMetadata = useCallback(() => {
        if (audioRef.current) {
            const newDuration = audioRef.current.duration;
            if (isFinite(newDuration)) {
                setDuration(newDuration);
            }
        }
    }, []);

    const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!progressRef.current || !audioRef.current || !isFinite(duration) || duration === 0) return;
        const rect = progressRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        audioRef.current.currentTime = percentage * duration;
    };

    const handleTranscribe = async () => {
        if (!src) {
            toast({ title: "Erro", description: "URL do áudio não encontrada.", variant: "destructive" });
            return;
        }
        setIsTranscribing(true);
        try {
            const result = await transcribeAudio({ audioUrl: src, workspaceId });
            if (result.transcription) {
                setTranscription(result.transcription);
                // Save to DB in the background if messageId exists
                if (messageId) {
                    await saveTranscriptionAction(messageId, result.transcription);
                    // Update local store to persist across navigation
                    if (chatId) {
                        updateMessage(chatId, messageId, { transcription: result.transcription });
                    }
                }
            }
        } catch (error: any) {
            toast({ title: "Erro ao transcrever", description: error.message || "Não foi possível transcrever o áudio.", variant: "destructive" });
        } finally {
            setIsTranscribing(false);
        }
    };

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('ended', () => setIsPlaying(false));

        if (initialDuration && isFinite(initialDuration)) {
            setDuration(initialDuration);
        } else {
            if (audio.readyState > 0) {
                handleLoadedMetadata();
            }
        }

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('ended', () => setIsPlaying(false));
        };
    }, [handleTimeUpdate, handleLoadedMetadata, initialDuration]);

    const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Premium styling
    const containerClasses = isFromMe
        ? "bg-transparent"
        : "bg-transparent";

    const playButtonClasses = isFromMe
        ? "bg-white/20 hover:bg-white/30 text-white"
        : "bg-blue-500 hover:bg-blue-600 text-white shadow-md shadow-blue-500/20";

    const waveformBaseColor = isFromMe ? "bg-white/30" : "bg-zinc-300/50";
    const waveformProgressColor = isFromMe ? "bg-white" : "bg-blue-500";

    const timeColor = isFromMe ? "text-white/70" : "text-zinc-500";
    const speedButtonColor = isFromMe
        ? "bg-white/20 text-white hover:bg-white/30"
        : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300";

    return (
        <div className={cn('flex flex-col gap-2 min-w-[280px]', containerClasses)}>
            <div className="flex items-center gap-3">
                <audio ref={audioRef} src={src} preload="metadata" />

                <button
                    onClick={handlePlayPause}
                    className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-all duration-200", playButtonClasses)}
                >
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current pl-0.5" />}
                </button>

                <div className="flex min-w-0 flex-grow flex-col justify-center gap-1">
                    <div
                        ref={progressRef}
                        onClick={handleSeek}
                        className="relative h-8 w-full cursor-pointer group"
                    >
                        <div className="absolute inset-0 flex items-center justify-between gap-[2px] px-1">
                            {simulatedWaveform.map((barHeight, index) => {
                                const barPercent = (index / simulatedWaveform.length) * 100;
                                const isPlayed = barPercent <= progressPercentage;
                                return (
                                    <div
                                        key={index}
                                        className={cn(
                                            "w-1.5 rounded-full transition-colors duration-150",
                                            isPlayed ? waveformProgressColor : waveformBaseColor
                                        )}
                                        style={{
                                            height: `${Math.max(20, barHeight * 100)}%`,
                                            opacity: isPlayed ? 1 : 0.6
                                        }}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className={cn("flex justify-between text-[10px] font-medium px-1", timeColor)}>
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                <button
                    onClick={togglePlaybackRate}
                    className={cn("h-7 px-2 rounded-full text-[10px] font-bold transition-colors flex-shrink-0", speedButtonColor)}
                >
                    {playbackRate}x
                </button>
            </div>

            <div className="mt-1">
                {transcription ? (
                    <p className="text-xs italic text-foreground p-2 rounded-md bg-secondary/50 border border-white/10">{transcription}</p>
                ) : isTranscribing ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-md bg-secondary/50">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Transcrevendo áudio...
                    </div>
                ) : (
                    !isFromMe && (
                        <Button variant="outline" size="sm" onClick={handleTranscribe} className="h-6 text-[10px] px-2 text-black bg-white hover:bg-white/90 border-none shadow-sm">
                            <Languages className="mr-1.5 h-3 w-3" />
                            Transcrever
                        </Button>
                    )
                )}
            </div>
        </div>
    );
}
