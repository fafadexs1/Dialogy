
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Send, Trash2, Loader2, Square, Play, Pause } from 'lucide-react';
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
  const [permission, setPermission] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const [isSending, setIsSending] = useState(false);

  const { toast } = useToast();

  const getMicrophonePermission = async () => {
    if ("MediaRecorder" in window) {
      try {
        const streamData = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        setPermission(true);
        setStream(streamData);
      } catch (err: any) {
        toast({ title: "Permissão Negada", description: "Você precisa permitir o acesso ao microfone para gravar áudios.", variant: 'destructive'});
      }
    } else {
       toast({ title: "Navegador Incompatível", description: "A gravação de áudio não é suportada pelo seu navegador.", variant: 'destructive'});
    }
  };

  const startRecording = () => {
    if (!stream) return;
    setIsRecording(true);
    setAudioUrl(null);
    setAudioBlob(null);

    const media = new MediaRecorder(stream, { mimeType: 'audio/mpeg' });
    mediaRecorder.current = media;
    mediaRecorder.current.start();
    
    setRecordingTime(0);
    recordingInterval.current = setInterval(() => {
        setRecordingTime(prevTime => prevTime + 1);
    }, 1000);

    let localAudioChunks: Blob[] = [];
    mediaRecorder.current.ondataavailable = (event) => {
      if (typeof event.data === "undefined") return;
      if (event.data.size === 0) return;
      localAudioChunks.push(event.data);
    };
    mediaRecorder.current.onstop = () => {
      const audioBlob = new Blob(localAudioChunks, { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(audioUrl);
      setAudioBlob(audioBlob);
      localAudioChunks = [];
      if(recordingInterval.current) clearInterval(recordingInterval.current);
    };
  };

  const stopRecording = () => {
    if(mediaRecorder.current) {
        mediaRecorder.current.stop();
        setIsRecording(false);
    }
  };
  
  const handleToggleRecording = () => {
      if(!permission) {
          getMicrophonePermission();
          return;
      }
      if(isRecording) {
          stopRecording();
      } else {
          startRecording();
      }
  }

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
                 <AudioPlayer src={audioUrl} />
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
        >
            {isRecording ? <Square className="h-5 w-5"/> : <Mic className="h-5 w-5" />}
        </Button>
        {isRecording && <div className="text-sm text-muted-foreground animate-pulse">Gravando...</div>}
    </div>
  );
}
