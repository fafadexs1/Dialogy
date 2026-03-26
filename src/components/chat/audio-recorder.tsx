'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Send, Trash2, Loader2, Square, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface AudioRecorderProps {
  onSend: (audioBlob: Blob, duration: number, mimetype: string) => Promise<void>;
}

const formatTime = (timeInSeconds: number) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function AudioRecorder({ onSend }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (recordingInterval.current) clearInterval(recordingInterval.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current || !dataArrayRef.current) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!canvasCtx) return;

    const bufferLength = analyser.frequencyBinCount;
    analyser.getByteTimeDomainData(dataArray as any);

    canvasCtx.fillStyle = 'rgb(0, 0, 0, 0)'; // Transparent
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgb(59, 130, 246)'; // Blue-500
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();

    animationFrameRef.current = requestAnimationFrame(drawWaveform);
  };

  const startRecording = async () => {
    setIsInitializing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      // Try OGG+Opus first (WhatsApp's preferred format), then WebM+Opus as fallback
      const preferredMimeTypes = [
        'audio/ogg; codecs=opus',
        'audio/ogg',
        'audio/webm; codecs=opus',
        'audio/webm'
      ];

      let mimeType = '';
      for (const type of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      if (!mimeType) {
        toast({ title: "Incompatível", description: "Navegador não suporta formatos de áudio compatíveis.", variant: 'destructive' });
        setIsInitializing(false);
        return;
      }

      console.log(`[AUDIO_RECORDER] Using mimeType: ${mimeType}`);

      const media = new MediaRecorder(stream, { mimeType });
      mediaRecorder.current = media;

      // Audio Context for Visualizer
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 2048;
      const bufferLength = analyser.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength) as any;

      drawWaveform();

      media.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingInterval.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      const chunks: Blob[] = [];
      media.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      media.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
        if (recordingInterval.current) clearInterval(recordingInterval.current);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };

    } catch (err) {
      console.error(err);
      toast({ title: "Erro", description: "Não foi possível acessar o microfone.", variant: 'destructive' });
    } finally {
      setIsInitializing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const handleCancel = () => {
    stopRecording();
    setAudioBlob(null);
    setRecordingTime(0);
  };

  const handleSend = async () => {
    if (!audioBlob) return;
    setIsSending(true);
    try {
      await onSend(audioBlob, recordingTime, 'audio/webm');
      handleCancel();
    } catch (error) {
      console.error(error);
      toast({ title: "Erro ao enviar", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  if (audioBlob && !isRecording) {
    return (
      <div className="flex items-center gap-2 w-full rounded-xl border border-slate-200/80 bg-white p-2 animate-in fade-in slide-in-from-bottom-2 dark:border-white/10 dark:bg-white/5">
        <Button variant="ghost" size="icon" onClick={handleCancel} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full h-10 w-10">
          <Trash2 className="h-5 w-5" />
        </Button>

        <div className="flex h-10 flex-1 items-center justify-center rounded-full bg-slate-100 px-4 dark:bg-black/20">
          <span className="text-sm font-mono text-slate-600 dark:text-white/70">Áudio gravado: {formatTime(recordingTime)}</span>
        </div>

        <Button size="icon" onClick={handleSend} disabled={isSending} className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 hover:from-blue-500 hover:to-indigo-500">
          {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-0.5" />}
        </Button>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-3 w-full p-2 bg-red-500/10 rounded-xl border border-red-500/20 animate-in fade-in slide-in-from-bottom-2">
        <div className="flex-1 flex items-center gap-3 px-2 overflow-hidden">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-red-200 font-mono min-w-[45px]">{formatTime(recordingTime)}</span>
          <canvas ref={canvasRef} className="h-8 w-full opacity-70" width={200} height={32} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          className="h-10 w-10 shrink-0 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </Button>

        <Button
          size="icon"
          onClick={stopRecording}
          className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 shrink-0"
        >
          <Send className="h-5 w-5 ml-0.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={isInitializing}
      className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors duration-150 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-white dark:hover:bg-white/5"
    >
      {isInitializing ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Mic className="h-[18px] w-[18px]" />}
    </button>
  );
}
