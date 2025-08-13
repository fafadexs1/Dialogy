
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
    const [audioDuration, setAudioDuration] = useState(duration || 0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            if (audio.duration !== Infinity) {
              setAudioDuration(audio.duration);
            }
            setCurrentTime(audio.currentTime);
        };

        const setAudioTime = () => {
            if (audio.duration === Infinity) return;
            const newProgress = (audio.currentTime / audio.duration) * 100;
            setProgress(newProgress);
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        }

        audio.addEventListener('loadedmetadata', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('loadedmetadata', setAudioData);
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
        if (!audio || audio.duration === Infinity) return;

        const scrubbableArea = e.currentTarget;
        const clickPosition = e.clientX - scrubbableArea.getBoundingClientRect().left;
        const scrubbableAreaWidth = scrubbableArea.offsetWidth;
        const newTime = (clickPosition / scrubbableAreaWidth) * audio.duration;
        
        audio.currentTime = newTime;
    };
    
    // Normalize waveform data to fit within a certain height, ensuring a minimum height for visual presence.
    const normalizedWaveform = waveform ? waveform.map(v => Math.max(2, (v / 255) * 28)) : new Array(50).fill(2);


    return (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50 w-full max-w-xs">
            <audio ref={audioRef} src={src} preload="metadata" />
            <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 flex-shrink-0 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                onClick={togglePlayPause}
            >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
            </Button>
            <div className="flex-1 flex flex-col justify-center gap-1.5 w-full min-w-0">
                <div
                    className="relative flex items-center h-7 w-full cursor-pointer group"
                    onClick={handleScrub}
                >
                    {/* Background Waveform */}
                    <div className="absolute inset-0 flex items-center w-full">
                        {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-0.5 rounded-full mx-px bg-muted-foreground/30"
                                style={{ height: `${height}px` }}
                            />
                        ))}
                    </div>
                     {/* Progress Waveform */}
                    <div className="absolute inset-0 flex items-center w-full" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
                         {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-0.5 rounded-full mx-px bg-primary"
                                style={{ height: `${height}px` }}
                            />
                        ))}
                    </div>
                    {/* Scrub Handle */}
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary shadow-lg transition-opacity opacity-0 group-hover:opacity-100"
                      style={{ left: `${progress}%`}}
                    ></div>
                </div>
                <div className="text-xs font-mono text-muted-foreground text-right -mt-1">
                    {isPlaying ? formatTime(currentTime) : formatTime(audioDuration)}
                </div>
            </div>
        </div>
    );
}
