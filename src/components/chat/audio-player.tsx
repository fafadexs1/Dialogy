
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
    src: string;
    waveform?: number[];
    duration?: number;
}

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds <= 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioPlayer({ src, waveform, duration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const scrubbableAreaRef = useRef<HTMLDivElement>(null);
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
            // Não resetar o currentTime aqui para manter a duração final visível
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
            // Se o áudio terminou, volta para o início antes de tocar de novo
            if (audio.currentTime >= audio.duration - 0.1) {
                audio.currentTime = 0;
            }
            audio.play().catch(error => console.error("Error playing audio:", error));
        }
        setIsPlaying(!isPlaying);
    };

    const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        const scrubbableArea = scrubbableAreaRef.current;
        if (!audio || !scrubbableArea || audio.duration === Infinity || isNaN(audio.duration)) return;

        const rect = scrubbableArea.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const scrubbableAreaWidth = scrubbableArea.offsetWidth;
        const newTime = (clickPosition / scrubbableAreaWidth) * audio.duration;
        
        audio.currentTime = newTime;
    };
    
    const normalizedWaveform = waveform ? waveform.map(v => Math.max(2, (v / 255) * 50)) : new Array(50).fill(2);

    return (
        <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-card p-3 shadow-md">
            <audio ref={audioRef} src={src} preload="metadata" />
            <button
                onClick={togglePlayPause}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 fill-current pl-0.5" />}
            </button>
            <div className="flex w-full flex-col justify-center gap-1">
                <div
                    ref={scrubbableAreaRef}
                    className="relative flex h-[50px] w-full cursor-pointer items-center"
                    onClick={handleScrub}
                >
                    {/* Background Waveform */}
                    <div className="absolute inset-0 flex w-full items-center gap-0.5">
                        {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-1 rounded-full bg-blue-200/70"
                                style={{ height: `${height}%` }}
                            />
                        ))}
                    </div>
                     {/* Progress Waveform */}
                    <div className="absolute inset-0 flex w-full items-center gap-0.5" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
                         {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-1 rounded-full bg-primary"
                                style={{ height: `${height}%` }}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(audioDuration)}</span>
                </div>
            </div>
        </div>
    );
}
