'use client';

import React, { useEffect, useRef, useState, useCallback, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Paperclip,
    Send,
    Smile,
    Loader2,
    Sparkles,
    Command,
    X,
    StickyNote,
    Signature,
    Globe,
    Users,
    Lock,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { type Chat, type Shortcut } from '@/lib/types';
import { AudioRecorder } from './audio-recorder';
import { ComposerAiMenu } from './composer-ai-menu';
import MediaPreview, { type MediaFileType } from './media-preview';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
    ssr: false,
    loading: () => <div className="h-[360px] w-[300px] rounded-xl bg-muted animate-pulse" />,
});

interface UseAutoResizeTextareaProps {
    minHeight: number;
    maxHeight?: number;
}

function useAutoResizeTextarea({
    minHeight,
    maxHeight,
}: UseAutoResizeTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustHeight = useCallback(
        (reset?: boolean) => {
            const textarea = textareaRef.current;
            if (!textarea) return;

            if (reset) {
                textarea.style.height = `${minHeight}px`;
                return;
            }

            textarea.style.height = `${minHeight}px`;
            const newHeight = Math.max(
                minHeight,
                Math.min(
                    textarea.scrollHeight,
                    maxHeight ?? Number.POSITIVE_INFINITY
                )
            );

            textarea.style.height = `${newHeight}px`;
        },
        [minHeight, maxHeight]
    );

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = `${minHeight}px`;
        }
    }, [minHeight]);

    useEffect(() => {
        const handleResize = () => adjustHeight();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [adjustHeight]);

    return { textareaRef, adjustHeight };
}

function TypingDots() {
    return (
        <div className="flex items-center ml-1">
            {[1, 2, 3].map((dot) => (
                <motion.div
                    key={dot}
                    className="w-1.5 h-1.5 bg-primary rounded-full mx-0.5"
                    initial={{ opacity: 0.3 }}
                    animate={{ 
                        opacity: [0.3, 1, 0.3],
                        scale: [0.85, 1.15, 0.85]
                    }}
                    transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: dot * 0.15,
                        ease: 'easeInOut',
                    }}
                />
            ))}
        </div>
    );
}

export interface AnimatedComposerProps {
    chat: Chat;
    value: string;
    onChange: (text: string) => void;
    onSubmit: (textOverride?: string) => Promise<void> | void;
    onSendAudio: (audioBlob: Blob, duration: number, mimetype: string) => Promise<void>;
    mediaFiles: MediaFileType[];
    setMediaFiles: React.Dispatch<React.SetStateAction<MediaFileType[]>>;
    isInternalNote: boolean;
    setIsInternalNote: React.Dispatch<React.SetStateAction<boolean>>;
    skipUserSignature: boolean;
    setSkipUserSignature: React.Dispatch<React.SetStateAction<boolean>>;
    isVoiceActive: boolean;
    setIsVoiceActive: (active: boolean) => void;
    shortcuts: Shortcut[];
    isAiTyping: boolean;
    aiTypingDisplayName?: string;
    showAiTypingOverlay?: boolean;
    isSpellChecking: boolean;
    onSpellCheck: () => Promise<void>;
    composerAiAgents: any[];
    selectedAutopilotAgent: any;
    isCopilotActive: boolean;
    isRequestingSuggestion: boolean;
    isTakingOverWithAi: boolean;
    canAiTakeOverConversation: boolean;
    onAgentChange: (agentId: string) => Promise<void>;
    onDisableCopilot: () => Promise<void>;
    onRequestSuggestion: () => Promise<void>;
    onLearnFromConversation: () => void;
    onOpenToolExecutions: () => void;
    onOpenAiTakeOver: () => void;
    emojiPickerTheme: 'light' | 'dark' | 'auto';
    isSendBurstActive?: boolean;
    sendFeedbackKey?: number;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    processFiles: (files: File[]) => Promise<void>;
    externalTextareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function AnimatedComposer({
    chat,
    value,
    onChange,
    onSubmit,
    onSendAudio,
    mediaFiles,
    setMediaFiles,
    isInternalNote,
    setIsInternalNote,
    skipUserSignature,
    setSkipUserSignature,
    isVoiceActive,
    setIsVoiceActive,
    shortcuts,
    isAiTyping,
    aiTypingDisplayName = 'Agente IA',
    showAiTypingOverlay = false,
    isSpellChecking,
    onSpellCheck,
    composerAiAgents,
    selectedAutopilotAgent,
    isCopilotActive,
    isRequestingSuggestion,
    isTakingOverWithAi,
    canAiTakeOverConversation,
    onAgentChange,
    onDisableCopilot,
    onRequestSuggestion,
    onLearnFromConversation,
    onOpenToolExecutions,
    onOpenAiTakeOver,
    emojiPickerTheme,
    isSendBurstActive,
    sendFeedbackKey,
    fileInputRef,
    handleFileChange,
    processFiles,
    externalTextareaRef,
}: AnimatedComposerProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [isFocused, setIsFocused] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState<number>(0);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [recentCommand, setRecentCommand] = useState<string | null>(null);

    const { textareaRef: internalTextareaRef, adjustHeight } = useAutoResizeTextarea({
        minHeight: 52,
        maxHeight: 180,
    });

    const textareaRef = externalTextareaRef || internalTextareaRef;
    const commandPaletteRef = useRef<HTMLDivElement>(null);
    const dragCounterRef = useRef(0);

    // Filter shortcuts based on query after "/"
    const filteredShortcuts = React.useMemo(() => {
        if (!value.includes('/')) return shortcuts;
        const slashIndex = value.lastIndexOf('/');
        const query = value.slice(slashIndex + 1).toLowerCase();
        if (!query) return shortcuts;
        return shortcuts.filter(s => 
            s.name.toLowerCase().includes(query) || 
            s.message.toLowerCase().includes(query)
        );
    }, [value, shortcuts]);

    // Manage command palette visibility when typing "/"
    useEffect(() => {
        const hasSlash = value.includes('/');
        if (hasSlash) {
            setShowCommandPalette(true);
            setActiveSuggestion(0);
        } else if (!hasSlash && showCommandPalette && !commandPaletteRef.current?.contains(document.activeElement)) {
            // Keep open only if manually opened via button
        }
    }, [value]);

    // Handle outside click for command palette
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const commandButton = document.querySelector('[data-composer-cmd-button]');
            if (
                commandPaletteRef.current &&
                !commandPaletteRef.current.contains(target) &&
                !commandButton?.contains(target)
            ) {
                setShowCommandPalette(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Adjust height on external value changes
    useEffect(() => {
        adjustHeight();
    }, [value, adjustHeight]);

    const canSendFromComposer = value.trim().length > 0 || mediaFiles.length > 0;

    const handleSelectShortcut = useCallback((shortcut: Shortcut) => {
        let newValue = shortcut.message;
        if (value.includes('/')) {
            const slashIndex = value.lastIndexOf('/');
            newValue = value.slice(0, slashIndex) + shortcut.message;
        }
        onChange(newValue);
        setShowCommandPalette(false);
        setRecentCommand(shortcut.name);
        setTimeout(() => setRecentCommand(null), 2500);

        if (textareaRef.current) {
            textareaRef.current.focus();
            setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newValue.length, newValue.length);
                    adjustHeight();
                }
            }, 0);
        }
    }, [value, onChange, textareaRef, adjustHeight]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (showCommandPalette && filteredShortcuts.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveSuggestion(prev => (prev < filteredShortcuts.length - 1 ? prev + 1 : 0));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveSuggestion(prev => (prev > 0 ? prev - 1 : filteredShortcuts.length - 1));
                return;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                if (filteredShortcuts[activeSuggestion]) {
                    handleSelectShortcut(filteredShortcuts[activeSuggestion]);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowCommandPalette(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSendFromComposer && !isAiTyping && !isSubmitting) {
                handleSubmit();
            }
        }
    };

    const handleSubmit = async () => {
        if (!canSendFromComposer || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onSubmit();
            adjustHeight(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            const files = Array.from(e.clipboardData.files) as File[];
            void processFiles(files);
        }
    };

    const handleEmojiSelect = (emojiData: any) => {
        const emoji = emojiData?.emoji || emojiData;
        const textarea = textareaRef.current;
        if (!textarea) {
            onChange(value + emoji);
            return;
        }

        const start = textarea.selectionStart ?? value.length;
        const end = textarea.selectionEnd ?? value.length;
        const nextValue = value.substring(0, start) + emoji + value.substring(end);
        onChange(nextValue);

        setTimeout(() => {
            textarea.focus();
            const nextCursor = start + emoji.length;
            textarea.setSelectionRange(nextCursor, nextCursor);
            adjustHeight();
        }, 0);
    };

    // Drag & drop handlers
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (e.dataTransfer.types.includes('Files')) {
            setIsDraggingFiles(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDraggingFiles(false);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDraggingFiles(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            void processFiles(Array.from(e.dataTransfer.files) as File[]);
        }
    };


    return (
        <div className="relative w-full space-y-2 select-text">
            {/* Main Composer Glass Card */}
            <motion.div
                data-input-container
                data-ready={canSendFromComposer}
                data-note={isInternalNote}
                data-voice={isVoiceActive}
                data-dragging={isDraggingFiles}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "relative rounded-2xl backdrop-blur-2xl transition-all duration-200",
                    "border shadow-2xl",
                    // Theme styling
                    "bg-card/90 dark:bg-[#0c0d12]/90",
                    "border-border/80 dark:border-white/[0.08]",
                    "shadow-black/5 dark:shadow-black/50",
                    // Focus state - softened border to let running beam stand out
                    isFocused && "border-primary/40 dark:border-white/20",
                    // Internal Note state
                    isInternalNote && "border-amber-500/50 bg-amber-500/[0.03] dark:bg-amber-500/[0.05]",
                    // Dragging state
                    isDraggingFiles && "border-dashed border-2 border-primary bg-primary/10"
                )}
                initial={{ scale: 0.99, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2 }}
            >
                {/* Sleek Running Border Beam Animation (active when focused) */}
                <AnimatePresence>
                    {isFocused && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden z-10 p-[1.5px]"
                            style={{
                                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                WebkitMaskComposite: 'xor',
                                mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                maskComposite: 'exclude',
                            }}
                        >
                            <motion.div
                                className="absolute -top-[150%] -left-[150%] h-[400%] w-[400%]"
                                style={{
                                    background: isInternalNote
                                        ? 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 270deg, rgba(245, 158, 11, 0.2) 305deg, rgb(245, 158, 11) 345deg, transparent 360deg)'
                                        : 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 270deg, hsl(var(--primary) / 0.15) 305deg, hsl(var(--primary)) 335deg, rgba(147, 51, 234, 0.85) 355deg, transparent 360deg)',
                                }}
                                animate={{ rotate: 360 }}
                                transition={{
                                    duration: 4,
                                    repeat: Infinity,
                                    ease: 'linear',
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
                {/* Dragging Files Overlay */}
                {isDraggingFiles && (
                    <div className="absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary bg-background/95 backdrop-blur-md pointer-events-none text-primary animate-in fade-in zoom-in-95 duration-150">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Paperclip className="w-5 h-5 text-primary" />
                        </div>
                        <p className="text-sm font-semibold">Solte os arquivos para anexar</p>
                        <p className="text-xs text-muted-foreground">Fotos, vídeos, documentos ou áudios</p>
                    </div>
                )}

                {/* Burst Feedback Ring */}
                {isSendBurstActive && (
                    <span 
                        key={sendFeedbackKey} 
                        className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-primary animate-ping opacity-30" 
                    />
                )}

                {/* Active Mode Banners */}
                <div className="space-y-1.5 px-3 pt-2.5">
                    {isInternalNote && (
                        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-medium">
                            <div className="flex items-center gap-2">
                                <StickyNote className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>Nota interna · visível somente para sua equipe</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsInternalNote(false)}
                                className="p-0.5 rounded hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 transition-colors"
                                aria-label="Sair da nota interna"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {skipUserSignature && (
                        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-400 text-xs font-medium">
                            <div className="flex items-center gap-2">
                                <Signature className="w-3.5 h-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                                <span>Esta mensagem será enviada sem assinatura</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSkipUserSignature(false)}
                                className="p-0.5 rounded hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 transition-colors"
                                aria-label="Restaurar assinatura"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {isSpellChecking && (
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Revisando ortografia...</span>
                        </div>
                    )}
                </div>

                {/* Media Files Preview */}
                {mediaFiles.length > 0 && (
                    <div className="px-3 pt-2">
                        <MediaPreview mediaFiles={mediaFiles} setMediaFiles={setMediaFiles} />
                    </div>
                )}

                {/* Floating Command Palette Popup */}
                <AnimatePresence>
                    {showCommandPalette && filteredShortcuts.length > 0 && (
                        <motion.div
                            ref={commandPaletteRef}
                            className="absolute left-3 right-3 bottom-full mb-2 backdrop-blur-2xl bg-popover/95 dark:bg-[#0c0d12]/95 rounded-xl z-50 shadow-2xl border border-border/80 dark:border-white/10 overflow-hidden"
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.98 }}
                            transition={{ duration: 0.15 }}
                        >
                            <div className="px-3 py-2 border-b border-border/60 dark:border-white/5 bg-muted/40 dark:bg-white/[0.02] flex items-center justify-between text-xs text-muted-foreground">
                                <span className="font-semibold flex items-center gap-1.5">
                                    <Command className="w-3.5 h-3.5 text-primary" />
                                    Respostas Rápidas e Atalhos
                                </span>
                                <span className="text-[11px] opacity-70">
                                    <kbd className="px-1 py-0.5 rounded bg-background border border-border">↑↓</kbd> navegar · <kbd className="px-1 py-0.5 rounded bg-background border border-border">Enter</kbd> selecionar
                                </span>
                            </div>

                            <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
                                {filteredShortcuts.map((shortcut, index) => (
                                    <motion.div
                                        key={shortcut.id}
                                        className={cn(
                                            "flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors",
                                            activeSuggestion === index
                                                ? "bg-primary text-primary-foreground font-medium shadow-sm"
                                                : "text-foreground hover:bg-accent/60 dark:hover:bg-white/5"
                                        )}
                                        onClick={() => handleSelectShortcut(shortcut)}
                                        onMouseEnter={() => setActiveSuggestion(index)}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={cn(
                                                "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
                                                activeSuggestion === index ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                                            )}>
                                                {shortcut.type === 'global' && <Globe className="w-3.5 h-3.5" />}
                                                {shortcut.type === 'team' && <Users className="w-3.5 h-3.5" />}
                                                {shortcut.type === 'private' && <Lock className="w-3.5 h-3.5" />}
                                                {!shortcut.type && <Sparkles className="w-3.5 h-3.5" />}
                                            </div>
                                            <div className="font-semibold truncate">
                                                /{shortcut.name}
                                            </div>
                                            <div className={cn(
                                                "truncate text-xs max-w-[260px] md:max-w-[340px]",
                                                activeSuggestion === index ? "text-primary-foreground/80" : "text-muted-foreground"
                                            )}>
                                                {shortcut.message}
                                            </div>
                                        </div>

                                        <span className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                                            activeSuggestion === index ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                                        )}>
                                            {shortcut.type || 'atalho'}
                                        </span>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Textarea Input Area */}
                <div className={cn("relative min-w-0 px-4 pt-3 pb-1", isVoiceActive && "hidden")}>
                    {/* AI typing animated indicator overlay */}
                    {showAiTypingOverlay && (
                        <div className="absolute inset-0 z-10 px-4 pt-3 pb-2 pointer-events-none select-none">
                            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                                <span>{aiTypingDisplayName} está digitando uma resposta</span>
                                <TypingDots />
                            </div>
                        </div>
                    )}

                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => {
                            onChange(e.target.value);
                            adjustHeight();
                        }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder={
                            isInternalNote
                                ? "Escreva uma nota interna para a equipe..."
                                : mediaFiles.length > 0
                                    ? "Adicione uma legenda para os arquivos..."
                                    : "Escreva uma mensagem... (digite / para respostas rápidas)"
                        }
                        disabled={isAiTyping}
                        className={cn(
                            "w-full px-1 py-1 text-[14px] leading-relaxed resize-none",
                            "bg-transparent border-none outline-none focus:outline-none focus:ring-0",
                            "placeholder:text-muted-foreground/45 scrollbar-thin",
                            isInternalNote ? "text-amber-950 dark:text-amber-200" : "text-foreground",
                            showAiTypingOverlay && "opacity-0"
                        )}
                        style={{
                            minHeight: "52px",
                            maxHeight: "180px",
                            overflowY: "auto",
                        }}
                    />
                </div>

                {/* Bottom Toolbar */}
                <div className="px-3 py-2.5 border-t border-border/50 dark:border-white/[0.06] flex items-center justify-between gap-3">
                    {/* Left Action Buttons */}
                    <div className={cn("flex min-w-0 items-center gap-1 flex-wrap sm:flex-nowrap", isVoiceActive && "hidden")}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                            multiple
                            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,audio/*"
                        />

                        {/* Attach Media Button */}
                        <motion.button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            whileTap={{ scale: 0.94 }}
                            className="p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/70 dark:hover:bg-white/[0.06] transition-colors relative group"
                            title="Anexar arquivo (fotos, vídeos, documentos)"
                            aria-label="Anexar arquivos"
                        >
                            <Paperclip className="w-4 h-4" />
                        </motion.button>

                        {/* Command Palette Button */}
                        <motion.button
                            type="button"
                            data-composer-cmd-button
                            onClick={() => setShowCommandPalette(prev => !prev)}
                            whileTap={{ scale: 0.94 }}
                            className={cn(
                                "p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/70 dark:hover:bg-white/[0.06] transition-colors relative group",
                                showCommandPalette && "bg-primary/10 text-primary dark:bg-white/10 dark:text-white"
                            )}
                            title="Atalhos e Respostas Rápidas (/)"
                            aria-label="Abrir respostas rápidas"
                        >
                            <Command className="w-4 h-4" />
                        </motion.button>

                        {/* Emoji Picker Popover */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.94 }}
                                    disabled={isAiTyping}
                                    className="p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/70 dark:hover:bg-white/[0.06] transition-colors relative group"
                                    title="Inserir emoji"
                                    aria-label="Abrir emojis"
                                >
                                    <Smile className="w-4 h-4" />
                                </motion.button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 border-none mb-2 bg-transparent shadow-none" align="start">
                                <EmojiPicker onEmojiClick={handleEmojiSelect} theme={emojiPickerTheme as any} />
                            </PopoverContent>
                        </Popover>

                        {/* Expandable Nota Interna Toggle */}
                        <motion.button
                            type="button"
                            layout
                            onClick={() => {
                                const next = !isInternalNote;
                                setIsInternalNote(next);
                                if (next) setSkipUserSignature(false);
                            }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isAiTyping}
                            className={cn(
                                "flex items-center gap-1.5 rounded-xl transition-all duration-200 relative group overflow-hidden select-none",
                                isInternalNote
                                    ? "px-2.5 py-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 shadow-sm"
                                    : "p-2 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 dark:hover:bg-amber-500/10"
                            )}
                            title={isInternalNote ? "Desativar nota interna" : "Ativar nota interna"}
                            aria-label={isInternalNote ? "Desativar nota interna" : "Ativar nota interna"}
                            aria-pressed={isInternalNote}
                        >
                            <StickyNote className={cn("w-4 h-4 shrink-0 transition-colors", isInternalNote && "text-amber-600 dark:text-amber-400")} />
                            <AnimatePresence initial={false}>
                                {isInternalNote && (
                                    <motion.span
                                        initial={{ width: 0, opacity: 0 }}
                                        animate={{ width: "auto", opacity: 1 }}
                                        exit={{ width: 0, opacity: 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                        className="text-xs font-semibold whitespace-nowrap overflow-hidden flex items-center gap-1"
                                    >
                                        <span>Nota interna</span>
                                        <X className="w-3 h-3 opacity-60 hover:opacity-100 shrink-0 ml-0.5" />
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>

                        {/* Expandable Sem Assinatura Toggle */}
                        <motion.button
                            type="button"
                            layout
                            disabled={isAiTyping || isInternalNote}
                            onClick={() => {
                                const next = !skipUserSignature;
                                setSkipUserSignature(next);
                                if (next) setIsInternalNote(false);
                            }}
                            whileTap={{ scale: 0.95 }}
                            className={cn(
                                "flex items-center gap-1.5 rounded-xl transition-all duration-200 relative group overflow-hidden select-none",
                                isInternalNote && "opacity-40 cursor-not-allowed",
                                skipUserSignature
                                    ? "px-2.5 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-700 dark:text-violet-300 shadow-sm"
                                    : "p-2 text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/10 dark:hover:bg-violet-500/10"
                            )}
                            title={skipUserSignature ? "Restaurar assinatura do atendente" : "Enviar sem assinatura"}
                            aria-label={skipUserSignature ? "Restaurar assinatura do atendente" : "Enviar sem assinatura"}
                            aria-pressed={skipUserSignature}
                        >
                            <Signature className={cn("w-4 h-4 shrink-0 transition-colors", skipUserSignature && "text-violet-600 dark:text-violet-400")} />
                            <AnimatePresence initial={false}>
                                {skipUserSignature && (
                                    <motion.span
                                        initial={{ width: 0, opacity: 0 }}
                                        animate={{ width: "auto", opacity: 1 }}
                                        exit={{ width: 0, opacity: 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                        className="text-xs font-semibold whitespace-nowrap overflow-hidden flex items-center gap-1"
                                    >
                                        <span>Sem assinatura</span>
                                        <X className="w-3 h-3 opacity-60 hover:opacity-100 shrink-0 ml-0.5" />
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>

                        {/* AI Copilot & Autopilot Menu */}
                        <ComposerAiMenu
                            key={chat.id}
                            agents={composerAiAgents}
                            selectedId={selectedAutopilotAgent?.id}
                            active={isCopilotActive}
                            busy={isAiTyping || isRequestingSuggestion || isTakingOverWithAi}
                            autonomous={Boolean(chat.assigned_system_agent_id)}
                            canTakeOver={canAiTakeOverConversation}
                            canSpellCheck={value.trim().length > 0}
                            spellChecking={isSpellChecking}
                            onActivate={onAgentChange}
                            onDeactivate={onDisableCopilot}
                            onSuggest={() => { void onRequestSuggestion(); }}
                            onSpellCheck={() => { void onSpellCheck(); }}
                            onLearn={onLearnFromConversation}
                            onExecutions={onOpenToolExecutions}
                            onTakeOver={onOpenAiTakeOver}
                        />

                    </div>

                    {/* Right Side: Audio recorder OR Send button */}
                    <div className={cn("flex items-center gap-2 shrink-0", isVoiceActive && "w-full min-w-0")}>
                        {!canSendFromComposer ? (
                            <div className={cn("min-w-0", isVoiceActive && "w-full")}>
                                <AudioRecorder
                                    key={chat.id}
                                    onSend={onSendAudio}
                                    onActiveChange={setIsVoiceActive}
                                    disabled={isAiTyping || isInternalNote}
                                />
                            </div>
                        ) : (
                            <motion.button
                                type="button"
                                onClick={handleSubmit}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.96 }}
                                disabled={isAiTyping || isSubmitting}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all select-none",
                                    "flex items-center gap-2",
                                    // High contrast styling matching AnimatedAIChat
                                    "bg-primary text-primary-foreground shadow-lg shadow-primary/20",
                                    "dark:bg-white dark:text-[#0A0A0B] dark:shadow-white/10 hover:opacity-95"
                                )}
                                aria-label="Enviar mensagem"
                            >
                                {isSubmitting ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                <span>Enviar</span>
                            </motion.button>
                        )}
                    </div>
                </div>
            </motion.div>


            {/* Helper Hint Line */}
            <div className="flex justify-between items-center px-1 text-[11px] text-muted-foreground/70">
                <span>
                    {isDraggingFiles
                        ? 'Solte os arquivos para anexar'
                        : isVoiceActive
                            ? 'Você pode ouvir e revisar antes de enviar.'
                            : mediaFiles.length
                                ? `${mediaFiles.length} arquivo(s) pronto(s) para envio`
                                : recentCommand
                                    ? `Comando /${recentCommand} inserido`
                                    : 'Digite / para encontrar uma resposta rápida'}
                </span>
                {!isVoiceActive && (
                    <span className="hidden sm:inline">
                        <kbd className="font-mono text-[10px]">Enter</kbd> envia · <kbd className="font-mono text-[10px]">Shift + Enter</kbd> quebra linha
                    </span>
                )}
            </div>
        </div>
    );
}
