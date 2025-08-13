'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Send, Trash2, Loader2, Square } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './audio-player';

interface AudioRecorderProps {
  onSend: (audioBase64: string, duration: number) => Promise<void>;
}

const formatTime = (timeInSeconds: number) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioRecorder({ onSend }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const { toast } = useToast();

  const getMicrophonePermission = async (): Promise<MediaStream | null> => {
    if (!("MediaRecorder" in window)) {
        toast({ title: "Navegador Incompatível", description: "A gravação de áudio não é suportada pelo seu navegador.", variant: 'destructive' });
        return null;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return stream;
    } catch (err) {
        toast({ title: "Permissão Negada", description: "Você precisa permitir o acesso ao microfone para gravar áudios.", variant: 'destructive' });
        return null;
    }
  };

  const startRecording = (stream: MediaStream) => {
    setIsRecording(true);
    setAudioUrl(null);
    setAudioBlob(null);

    const media = new MediaRecorder(stream);
    mediaRecorder.current = media;
    mediaRecorder.current.start();
    
    setRecordingTime(0);
    if(recordingInterval.current) clearInterval(recordingInterval.current);
    recordingInterval.current = setInterval(() => {
        setRecordingTime(prevTime => prevTime + 1);
    }, 1000);

    const localAudioChunks: Blob[] = [];
    mediaRecorder.current.ondataavailable = (event) => {
      if (typeof event.data === "undefined" || event.data.size === 0) return;
      localAudioChunks.push(event.data);
    };

    mediaRecorder.current.onstop = () => {
      const audioBlob = new Blob(localAudioChunks, { type: media.mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(audioUrl);
      setAudioBlob(audioBlob);
      if(recordingInterval.current) clearInterval(recordingInterval.current);
      // Clean up the stream tracks
      stream.getTracks().forEach(track => track.stop());
    };
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
        mediaRecorder.current.stop();
    }
    setIsRecording(false);
    if(recordingInterval.current) clearInterval(recordingInterval.current);
  };
  
  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      setIsInitializing(true);
      const stream = await getMicrophonePermission();
      if (stream) {
        startRecording(stream);
      }
      setIsInitializing(false);
    }
  };

  const handleDiscard = () => {
    setAudioUrl(null);
    setAudioBlob(null);
    setRecordingTime(0);
  }

  const handleSend = async () => {
    if (!audioBlob) return;
    setIsSending(true);

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
      const base64Audio = (reader.result as string).split(',')[1];
      await onSend(base64Audio, recordingTime);
      handleDiscard();
      setIsSending(false);
    };
  };
  
  if (audioUrl) {
    return (
        <div className="w-full flex items-center justify-between gap-2 p-2 border rounded-lg bg-background">
            <div className="flex items-center gap-2">
                <Button variant="destructive" size="icon" onClick={handleDiscard} className="h-10 w-10">
                    <Trash2 />
                </Button>
                 <AudioPlayer src={audioUrl} duration={recordingTime} />
            </div>
            <Button size="icon" className="h-10 w-10 bg-green-500 hover:bg-green-600" onClick={handleSend} disabled={isSending}>
                {isSending ? <Loader2 className="animate-spin"/> : <Send />}
            </Button>
        </div>
    )
  }

  return (
    <div className="w-full flex items-center gap-2">
        {isRecording && <p className='text-sm font-mono text-muted-foreground'>{formatTime(recordingTime)}</p>}
        <Button 
            type="button" 
            variant={isRecording ? 'destructive' : 'default'} 
            size="icon" 
            className={cn("h-10 w-10 transition-all", isRecording && 'ring-4 ring-destructive/30')}
            onClick={handleToggleRecording}
            disabled={isInitializing}
        >
            {isInitializing ? (
                <Loader2 className="h-5 w-5 animate-spin"/>
            ) : isRecording ? (
                <Square className="h-5 w-5"/> 
            ) : (
                <Mic className="h-5 w-5" />
            )}
        </Button>
        {isRecording && <div className="text-sm text-muted-foreground animate-pulse">Gravando...</div>}
    </div>
  );
}
