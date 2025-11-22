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

      const mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        toast({ title: "Incompatível", description: "Navegador não suporta audio/webm.", variant: 'destructive' });
        setIsInitializing(false);
        return;
      }

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
      <div className="flex items-center gap-2 w-full p-2 bg-white/5 rounded-xl border border-white/10 animate-in fade-in slide-in-from-bottom-2">
        <Button variant="ghost" size="icon" onClick={handleCancel} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full h-10 w-10">
          <Trash2 className="h-5 w-5" />
        </Button>

        <div className="flex-1 h-10 bg-black/20 rounded-full flex items-center justify-center px-4">
          <span className="text-white/70 text-sm font-mono">Áudio gravado: {formatTime(recordingTime)}</span>
        </div>

        <Button size="icon" onClick={handleSend} disabled={isSending} className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20">
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
          className="text-white/50 hover:text-white hover:bg-white/10 rounded-full h-10 w-10 shrink-0"
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
    <Button
      variant="default"
      size="icon"
      onClick={startRecording}
      disabled={isInitializing}
      className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl h-10 w-10 transition-all shadow-lg shadow-blue-500/20"
    >
      {isInitializing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
    </Button>
  );
}
