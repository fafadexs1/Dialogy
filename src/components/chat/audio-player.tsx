
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface AudioPlayerProps {
    src: string;
    waveform?: number[]; // Manter para não quebrar a tipagem, mas não será usado
    duration?: number;
}

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioPlayer({ src, duration }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [audioDuration, setAudioDuration] = useState(duration || 0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            const newDuration = audio.duration;
            if (newDuration !== Infinity && !isNaN(newDuration)) {
              setAudioDuration(newDuration);
            }
        };

        const setAudioTime = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        }

        audio.addEventListener('loadedmetadata', setAudioData);
        audio.addEventListener('durationchange', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);

        // Se a duração já veio da API, usa ela
        if (duration) {
            setAudioDuration(duration);
        }

        return () => {
            audio.removeEventListener('loadedmetadata', setAudioData);
            audio.removeEventListener('durationchange', setAudioData);
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
             if (audio.currentTime >= audio.duration - 0.1) {
                audio.currentTime = 0;
            }
            audio.play().catch(error => console.error("Error playing audio:", error));
        }
        setIsPlaying(!isPlaying);
    };

    const remainingTime = audioDuration - currentTime;
    const displayTime = isPlaying ? remainingTime : audioDuration;

    return (
        <div className="flex w-64 items-center gap-2 rounded-xl bg-white p-3 shadow-md border">
            <audio ref={audioRef} src={src} preload="metadata" />
            <button
                onClick={togglePlayPause}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
                {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current pl-0.5" />}
            </button>
            <div className="flex-grow flex items-center justify-center">
                 <span className="text-lg font-medium text-gray-700 font-mono tracking-tighter">
                    {formatTime(displayTime)}
                </span>
            </div>
        </div>
    );
}
