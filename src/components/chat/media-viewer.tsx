import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { X, ZoomIn, ZoomOut, Download, Play, Pause, Volume2, VolumeX, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import VideoPlayerPro from '../ui/video-player-pro';
import { ImageEditor } from './image-editor';
import { sendMediaAction } from '@/actions/messages';
import { useToast } from '@/hooks/use-toast';

interface MediaViewerProps {
    children: React.ReactNode;
    src: string;
    alt?: string;
    type: 'image' | 'video';
    fileName?: string;
    chatId?: string;
}

export function MediaViewer({ children, src, alt, type, fileName, chatId }: MediaViewerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const dragStartRef = React.useRef({ x: 0, y: 0 });
    const { toast } = useToast();

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const safeSrc = typeof src === 'string' && src.trim().length > 0 ? src : '';

    // Reset state when closed
    useEffect(() => {
        if (!isOpen) {
            setScale(1);
            setPosition({ x: 0, y: 0 });
            setIsEditing(false);

            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.currentTime = 0;
            }
        }
    }, [isOpen]);

    // Reset position when zooming out completely
    useEffect(() => {
        if (scale === 1) {
            setPosition({ x: 0, y: 0 });
        }
    }, [scale]);

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.5, 3));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.5, 1));

    // Mouse Events
    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > 1) {
            setIsDragging(true);
            dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
            e.preventDefault(); // Prevent default drag behavior
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && scale > 1) {
            const x = e.clientX - dragStartRef.current.x;
            const y = e.clientY - dragStartRef.current.y;
            setPosition({ x, y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Touch Events
    const handleTouchStart = (e: React.TouchEvent) => {
        if (scale > 1 && e.touches.length === 1) {
            setIsDragging(true);
            const touch = e.touches[0];
            dragStartRef.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (isDragging && scale > 1 && e.touches.length === 1) {
            const touch = e.touches[0];
            const x = touch.clientX - dragStartRef.current.x;
            const y = touch.clientY - dragStartRef.current.y;
            setPosition({ x, y });
        }
    };



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

    const handleSaveEdited = async (blob: Blob, name: string) => {
        if (!blob) return;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `edited_${name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setIsEditing(false);
        toast({ title: 'Sucesso', description: 'Imagem editada baixada.' });
    };

    const handleSendEdited = async (blob: Blob, name: string) => {
        if (!chatId) return;

        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64data = reader.result as string;

            // Format for MediaFilePayload is typically just the data string or full Data URL depending on backend.
            // internalSendMedia expects: mediaUrl: file.base64?.startsWith('http') ? file.base64 : undefined,
            // And in sendMediaAction -> mediaUrl: file.base64
            // Usually base64 string includes prefix "data:image/png;base64,". Evolution API usually handles that.

            try {
                const result = await sendMediaAction(
                    chatId,
                    '',
                    [{
                        base64: base64data,
                        filename: `edited_${name}`,
                        mimetype: blob.type,
                        mediatype: 'image',
                        deleteAfterSend: false
                    }],
                    null
                );

                if (result.success) {
                    toast({ title: 'Sucesso', description: 'Imagem enviada.' });
                    setIsEditing(false);
                } else {
                    toast({ title: 'Erro', description: result.error || 'Falha ao enviar.', variant: 'destructive' });
                }
            } catch (e) {
                console.error(e);
                toast({ title: 'Erro', description: 'Falha ao enviar imagem.', variant: 'destructive' });
            }
        };
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild onClick={() => setIsOpen(true)}>
                {children}
            </DialogTrigger>
            <DialogContent className="max-w-[100vw] max-h-[100vh] w-screen h-screen p-0 bg-transparent border-none shadow-none flex flex-col items-center justify-center overflow-hidden focus:outline-none [&>button]:hidden">
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {fileName || (type === 'image' ? 'Visualização de Imagem' : 'Player de Vídeo')}
                    </DialogTitle>
                    <DialogDescription>
                        {type === 'image' ? 'Visualizando imagem em tela cheia' : 'Reproduzindo vídeo em tela cheia'}
                    </DialogDescription>
                </DialogHeader>

                {isEditing && type === 'image' ? (
                    <div className="w-full h-full">
                        <ImageEditor
                            src={safeSrc}
                            fileName={fileName}
                            onSave={handleSaveEdited}
                            onSend={chatId ? handleSendEdited : undefined}
                            onCancel={() => setIsEditing(false)}
                        />
                    </div>
                ) : (
                    <>
                        <div className="relative w-full h-full flex items-center justify-center p-4 md:p-10" onClick={() => setIsOpen(false)}>
                            {!safeSrc ? (
                                <p className="text-sm text-white/70">Media unavailable</p>
                            ) : type === 'image' ? (
                                <div
                                    className={cn(
                                        "relative transition-transform duration-75 ease-out",
                                        scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                                    )}
                                    style={{
                                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onDoubleClick={() => window.open(safeSrc, '_blank')}
                                    onMouseDown={handleMouseDown}
                                    onMouseMove={handleMouseMove}
                                    onMouseUp={handleMouseUp}
                                    onMouseLeave={handleMouseUp}
                                    // Touch events for mobile
                                    onTouchStart={handleTouchStart}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={handleMouseUp}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        key={safeSrc}
                                        src={safeSrc}
                                        alt={alt || 'Media content'}
                                        className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl pointer-events-none select-none"
                                        draggable={false}
                                    />
                                </div>
                            ) : (

                                <div className="relative w-fit h-fit" onClick={(e) => e.stopPropagation()}>
                                    <VideoPlayerPro src={safeSrc} />
                                </div>
                            )}
                        </div>

                        {type === 'image' && (
                            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-full p-2 border border-white/10" onClick={(e) => e.stopPropagation()}>
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
                                <div className="w-px h-4 bg-white/20 mx-1" />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsEditing(true);
                                    }}
                                    className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-8 w-8"
                                    title="Editar Imagem"
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                        handleDownload();
                                    }}
                                    className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-8 w-8"
                                    title="Baixar imagem"
                                >
                                    <Download className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog >
    );
}
