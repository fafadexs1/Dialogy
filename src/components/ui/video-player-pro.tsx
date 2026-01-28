"use client";

import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Volume2, Volume1, VolumeX, Maximize2, RotateCw, Settings, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface VideoPlayerProProps {
    src: string;
}

const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
};

const VideoPlayerPro: React.FC<VideoPlayerProProps> = ({ src }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isEnded, setIsEnded] = useState<boolean>(false);
    const [volume, setVolume] = useState<number>(1);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [duration, setDuration] = useState<number>(0);
    const [showControls, setShowControls] = useState<boolean>(true);
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

    // Play / Pause / Restart
    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isEnded) {
            videoRef.current.currentTime = 0;
            setIsEnded(false);
        }
        isPlaying ? videoRef.current.pause() : videoRef.current.play();
        setIsPlaying(!isPlaying);
    };

    // Update progress and time
    const handleTimeUpdate = () => {
        if (!videoRef.current) return;
        const prog = (videoRef.current.currentTime / videoRef.current.duration) * 100;
        setProgress(isFinite(prog) ? prog : 0);
        setCurrentTime(videoRef.current.currentTime);
        setDuration(videoRef.current.duration || 0);
    };

    // Video ended
    const handleEnded = () => {
        setIsEnded(true);
        setIsPlaying(false);
    };

    // Seek
    const handleSeek = (percent: number) => {
        if (!videoRef.current) return;
        const time = (percent / 100) * (videoRef.current.duration || 0);
        if (isFinite(time)) videoRef.current.currentTime = time;
        setProgress(percent);
    };

    // Fullscreen
    const toggleFullscreen = () => {
        if (!containerRef.current) return;

        // Must be called inside a user-initiated event
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch((err) => {
                console.error("Fullscreen request failed:", err);
            });
        } else {
            document.exitFullscreen().catch((err) => {
                console.error("Exit fullscreen failed:", err);
            });
        }
    };

    // Toggle mute
    const toggleMute = () => {
        if (!videoRef.current) return;
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
        setVolume(!isMuted ? 0 : 1);
        if (!isMuted) videoRef.current.volume = 0;
        else videoRef.current.volume = 1;
    };

    // Download video
    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent play/pause toggle
        if (!src) return;
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'video.mp4'; // Default name, could be improved if props passed fileName
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading video:', error);
        }
    };

    return (
        <motion.div
            ref={containerRef}
            className="relative w-fit h-fit max-w-full max-h-[85vh] mx-auto overflow-hidden rounded-xl bg-black shadow-2xl group flex flex-col justify-center"
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
        >
            <video
                ref={videoRef}
                className="w-auto h-auto max-h-[85vh] max-w-full mx-auto block"
                src={src}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                onClick={togglePlay}
                playsInline
            />

            {/* Controls */}
            <AnimatePresence>
                {showControls && (
                    <motion.div
                        className="absolute bottom-4 left-1/2 w-[96%] backdrop-blur-md bg-black/40 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-lg"
                        initial={{ y: 20, opacity: 0, x: "-50%" }}
                        animate={{ y: 0, opacity: 1, x: "-50%" }}
                        exit={{ y: 20, opacity: 0, x: "-50%" }}
                        transition={{ duration: 0.2 }}
                    >
                        {/* Progress */}
                        <div
                            className="relative w-full h-1.5 bg-white/20 rounded-full cursor-pointer hover:h-2 transition-all group"
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                handleSeek((x / rect.width) * 100);
                            }}
                        >
                            <div
                                className="absolute top-0 left-0 h-full bg-blue-500 rounded-full group-hover:bg-blue-400 transition-colors"
                                style={{ width: `${progress}%` }}
                            />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-3 w-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ left: `${progress}%` }}
                            />
                        </div>

                        {/* Control Row */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {/* Play / Pause / Restart */}
                                <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-8 w-8" onClick={togglePlay}>
                                    {isEnded ? <RotateCw className="w-5 h-5" /> : isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                                </Button>

                                {/* Volume */}
                                <div className="flex items-center gap-2 group">
                                    <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-8 w-8" onClick={toggleMute}>
                                        {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : volume > 0.5 ? <Volume2 className="w-5 h-5" /> : <Volume1 className="w-5 h-5" />}
                                    </Button>
                                    <div className="w-0 overflow-hidden group-hover:w-20 transition-all duration-300">
                                        <Slider
                                            value={[isMuted ? 0 : volume * 100]}
                                            onValueChange={(val: number[]) => {
                                                const newVolume = val[0] / 100;
                                                if (videoRef.current) videoRef.current.volume = newVolume;
                                                setVolume(newVolume);
                                                setIsMuted(newVolume === 0);
                                            }}
                                            step={1}
                                            min={0}
                                            max={100}
                                            className="w-20"
                                        />
                                    </div>
                                </div>

                                {/* Timer */}
                                <span className="text-white/80 text-xs font-mono ml-2 pointer-events-none select-none">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {/* Download */}
                                <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-8 w-8" onClick={handleDownload} title="Baixar Vídeo">
                                    <Download className="w-4 h-4" />
                                </Button>

                                {/* Settings */}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-8 w-8">
                                            <Settings className="w-4 h-4" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="bg-black/90 border border-white/10 w-48 p-2 text-white backdrop-blur-xl" side="top">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between px-2 py-1">
                                                <span className="text-xs font-medium text-white/60">Speed</span>
                                            </div>
                                            <div className="grid grid-cols-4 gap-1">
                                                {[0.5, 1, 1.5, 2].map((s) => (
                                                    <Button
                                                        key={s}
                                                        variant={playbackSpeed === s ? "secondary" : "ghost"}
                                                        size="sm"
                                                        className={cn(
                                                            "h-7 text-xs",
                                                            playbackSpeed === s ? "bg-white text-black hover:bg-white/90" : "text-white hover:bg-white/10"
                                                        )}
                                                        onClick={() => {
                                                            if (videoRef.current) videoRef.current.playbackRate = s;
                                                            setPlaybackSpeed(s);
                                                        }}
                                                    >
                                                        {s}x
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                {/* Fullscreen */}
                                <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 h-8 w-8" onClick={toggleFullscreen}>
                                    <Maximize2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default VideoPlayerPro;
