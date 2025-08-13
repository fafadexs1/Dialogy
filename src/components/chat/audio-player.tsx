'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
    src: string;
    waveform?: number[];
    duration?: number;
}

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioPlayer({ src, waveform = [], duration: initialDuration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(initialDuration || 0);

    const normalizedWaveform = waveform.length > 0
        ? waveform.map(v => Math.max(0.05, v / 100)) // Ensure a minimum height for visibility
        : Array(50).fill(0).map(() => Math.random() * 0.6 + 0.1); // Fallback for missing waveform

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
        }

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('ended', () => setIsPlaying(false));
        };
    }, [handleTimeUpdate, handleLoadedMetadata, initialDuration]);

    const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex w-full max-w-xs items-center gap-3">
            <audio ref={audioRef} src={src} preload="metadata" />
            
            <button
                onClick={handlePlayPause}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
                {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current pl-0.5" />}
            </button>

            <div className="flex flex-col w-full flex-grow min-w-0">
                <div 
                  ref={progressRef}
                  onClick={handleSeek}
                  className="relative h-8 w-full cursor-pointer"
                >
                    <div className="absolute top-0 left-0 flex h-full w-full items-center gap-px overflow-hidden">
                        {normalizedWaveform.map((bar, index) => (
                             <div 
                                key={index} 
                                className="w-[3px] rounded-full bg-primary/30"
                                style={{ height: `${bar * 100}%`}}
                            />
                        ))}
                    </div>
                    <div className="absolute top-0 left-0 h-full overflow-hidden" style={{ width: `${progressPercentage}%`}}>
                        <div className="flex h-full items-center gap-px" style={{ width: progressRef.current?.offsetWidth }}>
                             {normalizedWaveform.map((bar, index) => (
                                <div 
                                    key={index} 
                                    className="w-[3px] rounded-full bg-primary"
                                    style={{ height: `${bar * 100}%`}}
                                />
                            ))}
                        </div>
                    </div>
                     <div 
                        className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background" 
                        style={{ left: `${progressPercentage}%` }}
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