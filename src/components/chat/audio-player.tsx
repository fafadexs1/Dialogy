
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

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
            if (audio.duration === Infinity || isNaN(audio.duration) || audio.duration === 0) return;
            const newProgress = (audio.currentTime / audio.duration) * 100;
            setProgress(newProgress);
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(100);
            setCurrentTime(audioDuration);
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
    }, [duration, audioDuration]);

    const togglePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            if (audio.currentTime >= audio.duration - 0.1) {
                audio.currentTime = 0;
                setProgress(0);
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
    
    // Normalize waveform data. If none is provided, create a default "flat" waveform.
    // The value is a percentage of the container's height.
    const normalizedWaveform = waveform 
        ? waveform.map(v => Math.max(5, (v / 255) * 100))
        : Array.from({ length: 40 }, () => 30); // Default flat wave

    return (
        <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-white p-4 shadow-md border">
             <audio ref={audioRef} src={src} preload="metadata" />
            <button
                onClick={togglePlayPause}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
                {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current pl-0.5" />}
            </button>
            <div className="flex-grow flex flex-col justify-center">
                 <div
                    ref={scrubbableAreaRef}
                    className="relative flex h-[50px] w-full cursor-pointer items-center gap-0.5"
                    onClick={handleScrub}
                >
                    {/* Background Waveform */}
                    <div className="absolute inset-0 flex w-full items-center gap-0.5">
                        {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-[3px] rounded-full bg-muted"
                                style={{ height: `${height}%` }}
                            />
                        ))}
                    </div>
                     {/* Progress Waveform */}
                    <div className="absolute inset-0 flex w-full items-center gap-0.5" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
                         {normalizedWaveform.map((height, i) => (
                            <div
                                key={i}
                                className="w-[3px] rounded-full bg-primary"
                                style={{ height: `${height}%` }}
                            />
                        ))}
                    </div>
                </div>
                <div className="mt-1 flex justify-between text-xs font-medium text-muted-foreground">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(audioDuration)}</span>
                </div>
            </div>
        </div>
    );
}
