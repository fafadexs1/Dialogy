'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
    src: string;
    duration?: number;
}

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioPlayer({ src, duration: initialDuration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(initialDuration || 0);

    // Gerar uma forma de onda simulada e esteticamente agradável no frontend.
    const simulatedWaveform = React.useMemo(() => 
        Array.from({ length: 40 }, () => Math.random() * 0.8 + 0.2)
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
        if (!progressRef.current || !audioRef.current || !isFinite(duration)) return;
        const rect = progressRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        audioRef.current.currentTime = percentage * duration;
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('ended', () => setIsPlaying(false));
        
        if(initialDuration && isFinite(initialDuration)) {
            setDuration(initialDuration);
        } else {
            // Se a duração não for fornecida, tenta obtê-la quando os metadados forem carregados
             if(audio.readyState > 0) {
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

    return (
        <div className="flex w-full max-w-md items-center gap-3">
            <audio ref={audioRef} src={src} preload="metadata" />
            
            <button
                onClick={handlePlayPause}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
                {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current pl-0.5" />}
            </button>

            <div className="flex min-w-0 flex-grow flex-col">
                <div 
                  ref={progressRef}
                  onClick={handleSeek}
                  className="relative h-8 w-full cursor-pointer"
                >
                    {/* Background Waveform */}
                    <div className="absolute top-0 left-0 flex h-full w-full items-center gap-px overflow-hidden">
                        {simulatedWaveform.map((barHeight, index) => (
                             <div 
                                key={index} 
                                className="w-[3px] rounded-full bg-muted-foreground/30"
                                style={{ height: `${barHeight * 100}%`}}
                            />
                        ))}
                    </div>
                    {/* Progress Waveform */}
                    <div className="absolute top-0 left-0 h-full overflow-hidden" style={{ width: `${progressPercentage}%`}}>
                        <div className="flex h-full items-center gap-px" style={{ width: progressRef.current?.offsetWidth }}>
                             {simulatedWaveform.map((barHeight, index) => (
                                <div 
                                    key={index} 
                                    className="w-[3px] rounded-full bg-primary"
                                    style={{ height: `${barHeight * 100}%`}}
                                />
                            ))}
                        </div>
                    </div>
                    {/* Seek Handle */}
                     <div 
                        className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background transition-all" 
                        style={{ left: `calc(${progressPercentage}% - 5px)` }}
                    />
                </div>

                <div className="flex justify-between text-xs font-mono text-muted-foreground">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>
        </div>
    );
}
