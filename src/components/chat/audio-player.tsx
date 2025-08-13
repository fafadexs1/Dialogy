
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
    src: string;
    waveform?: number[];
    duration?: number;
}

const formatTime = (timeInSeconds: number) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioPlayer({ src, waveform, duration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            setCurrentTime(audio.currentTime);
        };

        const setAudioTime = () => {
            const newProgress = (audio.currentTime / audio.duration) * 100;
            setProgress(newProgress);
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        }

        audio.addEventListener('loadeddata', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('loadeddata', setAudioData);
            audio.removeEventListener('timeupdate', setAudioTime);
            audio.removeEventListener('ended', handleEnded);
        };
    }, []);

    const togglePlayPause = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio) return;

        const scrubbableArea = e.currentTarget;
        const clickPosition = e.clientX - scrubbableArea.getBoundingClientRect().left;
        const scrubbableAreaWidth = scrubbableArea.offsetWidth;
        const newTime = (clickPosition / scrubbableAreaWidth) * audio.duration;
        
        audio.currentTime = newTime;
    };
    
    // Normalize waveform data to fit within a certain height
    const normalizedWaveform = waveform ? waveform.map(v => Math.max(2, (v / 255) * 28)) : new Array(50).fill(2);


    return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50 w-full max-w-xs">
            <audio ref={audioRef} src={src} preload="metadata" />
            <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 flex-shrink-0 bg-white/70 hover:bg-white text-primary"
                onClick={togglePlayPause}
            >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <div className="flex-1 flex flex-col justify-center">
                <div
                    className="relative flex items-end h-7 w-full cursor-pointer"
                    onClick={handleScrub}
                >
                    {normalizedWaveform.map((height, i) => (
                        <div
                            key={i}
                            className={cn(
                                "w-[2px] rounded-full mx-px",
                                (i / normalizedWaveform.length * 100) < progress ? 'bg-primary' : 'bg-muted-foreground/50'
                            )}
                            style={{ height: `${height}px` }}
                        />
                    ))}
                </div>
                <div className="text-xs font-mono text-muted-foreground text-right mt-1">
                    {isPlaying ? formatTime(currentTime) : formatTime(duration || 0)}
                </div>
            </div>
        </div>
    );
}

