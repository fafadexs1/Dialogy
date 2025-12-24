import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { X, ZoomIn, ZoomOut, Download, Play, Pause, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MediaViewerProps {
    children: React.ReactNode;
    src: string;
    alt?: string;
    type: 'image' | 'video';
    fileName?: string;
}

export function MediaViewer({ children, src, alt, type, fileName }: MediaViewerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [scale, setScale] = useState(1);

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const safeSrc = typeof src === 'string' && src.trim().length > 0 ? src : '';

    // Reset state when closed
    useEffect(() => {
        if (!isOpen) {
            setScale(1);

            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.currentTime = 0;
            }
        }
    }, [isOpen]);

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.5, 3));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.5, 1));



    const handleDownload = async () => {
        if (!safeSrc) return;
        try {
            const response = await fetch(safeSrc);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName || (type === 'image' ? 'image.png' : 'video.mp4');
            let appended = false;
            try {
                document.body.appendChild(a);
                appended = true;
                a.click();
            } finally {
                window.URL.revokeObjectURL(url);
                if (appended && a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            }
        } catch (error) {
            console.error('Error downloading media:', error);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild onClick={() => setIsOpen(true)}>
                {children}
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-black/95 border-none backdrop-blur-xl flex flex-col items-center justify-center overflow-hidden focus:outline-none">
                <DialogHeader className="absolute top-4 left-4 right-4 z-50 flex flex-row items-center justify-between bg-transparent border-none p-0">
                    <div className="flex items-center gap-2">
                        <DialogTitle className="text-white font-medium truncate max-w-[300px]">
                            {fileName || (type === 'image' ? 'Visualização de Imagem' : 'Player de Vídeo')}
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            {type === 'image' ? 'Visualizando imagem em tela cheia' : 'Reproduzindo vídeo em tela cheia'}
                        </DialogDescription>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleDownload}
                            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-10 w-10"
                            title="Baixar"
                        >
                            <Download className="h-5 w-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsOpen(false)}
                            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-10 w-10"
                            title="Fechar"
                        >
                            <X className="h-6 w-6" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="relative w-full h-full flex items-center justify-center p-4 md:p-10">
                    {!safeSrc ? (
                        <p className="text-sm text-white/70">Media unavailable</p>
                    ) : type === 'image' ? (
                        <div
                            className="relative transition-transform duration-200 ease-out"
                            style={{ transform: `scale(${scale})` }}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={safeSrc}
                                alt={alt || 'Media content'}
                                className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
                            />
                        </div>
                    ) : (

                        <div className="relative w-full max-w-5xl aspect-video bg-black rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10">
                            <video
                                ref={videoRef}
                                src={safeSrc}
                                className="w-full h-full object-contain"
                                controls
                                playsInline
                            />
                        </div>
                    )}
                </div>

                {type === 'image' && (
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-full p-2 border border-white/10">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleZoomOut}
                            disabled={scale <= 1}
                            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-8 w-8"
                        >
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <span className="text-xs text-white font-mono w-12 text-center">
                            {Math.round(scale * 100)}%
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleZoomIn}
                            disabled={scale >= 3}
                            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-8 w-8"
                        >
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog >
    );
}
