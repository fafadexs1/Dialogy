
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
    if (isNaN(timeInSeconds) || timeInSeconds === 0) return '0:00';
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
            if (audio.duration !== Infinity && !isNaN(audio.duration)) {
              setAudioDuration(audio.duration);
            }
        };

        const setAudioTime = () => {
            if (audio.duration === Infinity || isNaN(audio.duration)) return;
            const newProgress = (audio.currentTime / audio.duration) * 100;
            setProgress(newProgress);
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
            audio.currentTime = 0;
        }

        audio.addEventListener('loadedmetadata', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);

        if (duration) {
            setAudioDuration(duration);
        }

        return () => {
            audio.removeEventListener('loadedmetadata', setAudioData);
            audio.removeEventListener('timeupdate', setAudioTime);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [duration]);

    const togglePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(error => console.error("Error playing audio:", error));
        }
        setIsPlaying(!isPlaying);
    };

    const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || audio.duration === Infinity || isNaN(audio.duration)) return;

        const scrubbableArea = e.currentTarget;
        const clickPosition = e.clientX - scrubbableArea.getBoundingClientRect().left;
        const scrubbableAreaWidth = scrubbableArea.offsetWidth;
        const newTime = (clickPosition / scrubbableAreaWidth) * audio.duration;
        
        audio.currentTime = newTime;
    };
    
    // Normalize waveform for better visual appearance, ensuring a minimum height.
    const normalizedWaveform = waveform ? waveform.map(v => Math.max(2, (v / 255) * 28)) : new Array(50).fill(2);


    return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 w-full max-w-xs">
            <audio ref={audioRef} src={src} preload="metadata" />
            <Button
                variant="default"
                size="icon"
                className="h-10 w-10 flex-shrink-0 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                onClick={togglePlayPause}
            >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
            </Button>
            <div className="flex-1 flex flex-col justify-center gap-1 w-full min-w-0">
                <div
                    className="relative flex items-center h-7 w-full cursor-pointer group"
                    onClick={handleScrub}
                >
                    {/* Background Waveform */}
                    <div className="absolute inset-0 flex items-center w-full">
                        {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-1 rounded-full mx-px bg-muted-foreground/30 transition-all duration-300 group-hover:bg-muted-foreground/50"
                                style={{ height: `${height}px` }}
                            />
                        ))}
                    </div>
                     {/* Progress Waveform */}
                    <div className="absolute inset-0 flex items-center w-full transition-all duration-75" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
                         {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-1 rounded-full mx-px bg-gradient-to-b from-primary to-primary/70"
                                style={{ height: `${height}px` }}
                            />
                        ))}
                    </div>
                    {/* Scrub Handle */}
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-lg border-2 border-primary transition-opacity opacity-0 group-hover:opacity-100"
                      style={{ left: `${progress}%`}}
                    ></div>
                </div>
                <div className="text-xs font-mono text-muted-foreground text-right -mt-0.5">
                    {formatTime(currentTime)} / {formatTime(audioDuration)}
                </div>
            </div>
        </div>
    );
}

