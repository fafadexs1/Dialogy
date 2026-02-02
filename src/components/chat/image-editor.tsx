import React, { useRef, useState, useCallback, useEffect } from "react";
import Cropper, { ReactCropperElement } from "react-cropper";
import "cropperjs/dist/cropper.css";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
    RotateCcw,
    RotateCw,
    FlipHorizontal,
    FlipVertical,
    Check,
    X,
    Undo2,
    Sun,
    Contrast,
    Send,
    Download
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ImageEditorProps {
    src: string;
    fileName?: string;
    onSave: (blob: Blob, fileName: string) => Promise<void>;
    onSend?: (blob: Blob, fileName: string) => Promise<void>;
    onCancel: () => void;
}

export function ImageEditor({ src, fileName = "image.png", onSave, onSend, onCancel }: ImageEditorProps) {
    const cropperRef = useRef<ReactCropperElement>(null);
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const [scaleX, setScaleX] = useState(1);
    const [scaleY, setScaleY] = useState(1);
    const [rotation, setRotation] = useState(0);

    // Apply CSS filters to the cropper preview
    // Note: CropperJS doesn't inherently support filters on the canvas export directly,
    // so we apply visual filters via CSS and then process the export manually.
    const filterStyle = {
        filter: `brightness(${brightness}%) contrast(${contrast}%)`
    };

    const handleRotate = (deg: number) => {
        const cropper = cropperRef.current?.cropper;
        if (cropper) {
            cropper.rotate(deg);
            setRotation((prev) => prev + deg);
        }
    };

    const handleFlip = (axis: 'h' | 'v') => {
        const cropper = cropperRef.current?.cropper;
        if (cropper) {
            if (axis === 'h') {
                const newScaleX = scaleX === 1 ? -1 : 1;
                cropper.scaleX(newScaleX);
                setScaleX(newScaleX);
            } else {
                const newScaleY = scaleY === 1 ? -1 : 1;
                cropper.scaleY(newScaleY);
                setScaleY(newScaleY);
            }
        }
    };

    const handleReset = () => {
        const cropper = cropperRef.current?.cropper;
        if (cropper) {
            cropper.reset();
            setBrightness(100);
            setContrast(100);
            setScaleX(1);
            setScaleY(1);
            setRotation(0);
        }
    };

    const processImage = useCallback(async (action: 'download' | 'send') => {
        const cropper = cropperRef.current?.cropper;
        if (!cropper) return;

        // 1. Get cropped canvas
        const originalCanvas = cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });

        if (!originalCanvas) return;

        // 2. Apply filters if defined
        let finalCanvas = originalCanvas;
        if (brightness !== 100 || contrast !== 100) {
            const canvas = document.createElement('canvas');
            canvas.width = originalCanvas.width;
            canvas.height = originalCanvas.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Apply filters
                ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
                ctx.drawImage(originalCanvas, 0, 0);
                finalCanvas = canvas;
            }
        }

        // 3. Export to Blob
        finalCanvas.toBlob(async (blob) => {
            if (!blob) return;
            if (action === 'download') {
                await onSave(blob, fileName);
            } else if (action === 'send' && onSend) {
                await onSend(blob, fileName);
            }
        }, 'image/png', 0.95);

    }, [brightness, contrast, fileName, onSave, onSend]);

    return (
        <div className="flex flex-col h-full w-full bg-black/95 relative animate-in fade-in duration-200">
            {/* Main Area */}
            <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4">
                <style jsx global>{`
                    .cropper-view-box, .cropper-face {
                        border-radius: 0;
                        outline: none;
                    }
                    /* Apply filters to the image inside cropper container */
                    .cropper-container img {
                        filter: brightness(${brightness}%) contrast(${contrast}%);
                        transition: filter 0.1s;
                    }
                `}</style>
                <Cropper
                    src={src}
                    style={{ height: "100%", width: "100%" }}
                    initialAspectRatio={NaN} // Free crop
                    guides={true}
                    ref={cropperRef}
                    viewMode={1}
                    dragMode="move"
                    autoCropArea={0.9}
                    background={false}
                    className="max-h-[70vh]"
                />
            </div>

            {/* Controls */}
            <div className="bg-zinc-900 border-t border-white/10 p-4 space-y-4 shrink-0 z-20">

                {/* Sliders Row */}
                <div className="flex items-center justify-center gap-8 max-w-2xl mx-auto px-4">
                    <div className="flex items-center gap-3 flex-1">
                        <Sun className="w-4 h-4 text-white/70" />
                        <Slider
                            value={[brightness]}
                            min={50}
                            max={150}
                            step={1}
                            onValueChange={(val) => setBrightness(val[0])}
                            className="flex-1 cursor-pointer"
                        />
                    </div>
                    <div className="flex items-center gap-3 flex-1">
                        <Contrast className="w-4 h-4 text-white/70" />
                        <Slider
                            value={[contrast]}
                            min={50}
                            max={150}
                            step={1}
                            onValueChange={(val) => setContrast(val[0])}
                            className="flex-1 cursor-pointer"
                        />
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                    {/* Left: Transformations */}
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleRotate(-90)} className="text-white hover:bg-white/10">
                                        <RotateCcw className="w-5 h-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Girar -90°</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleRotate(90)} className="text-white hover:bg-white/10">
                                        <RotateCw className="w-5 h-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Girar +90°</TooltipContent>
                            </Tooltip>

                            <div className="w-px h-6 bg-white/20 mx-1" />

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleFlip('h')} className="text-white hover:bg-white/10">
                                        <FlipHorizontal className="w-5 h-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Espelhar Horizontal</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleFlip('v')} className="text-white hover:bg-white/10">
                                        <FlipVertical className="w-5 h-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Espelhar Vertical</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <Button variant="ghost" size="sm" onClick={handleReset} className="ml-2 text-white/50 hover:text-white hover:bg-white/10 text-xs">
                            <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Resetar
                        </Button>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-3">
                        <Button variant="secondary" onClick={onCancel} className="gap-2 bg-white/10 hover:bg-white/20 text-white border-none">
                            <X className="w-4 h-4" /> Cancelar
                        </Button>

                        {onSend && (
                            <Button variant="default" onClick={() => processImage('send')} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white border-none">
                                <Send className="w-4 h-4" /> Enviar
                            </Button>
                        )}

                        <Button variant="default" onClick={() => processImage('download')} className="gap-2 bg-green-600 hover:bg-green-700 text-white border-none">
                            <Download className="w-4 h-4" /> Baixar
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
