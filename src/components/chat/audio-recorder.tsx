'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, ArrowUp, Trash2, Loader2, Square, Pause, Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { RecordingPreview } from './recording-preview';
import { cn } from '@/lib/utils';
import styles from './composer.module.css';

interface AudioRecorderProps {
  onSend: (audioBlob: Blob, duration: number, mimetype: string) => Promise<void>;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
}

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function AudioRecorder({ onSend, onActiveChange, disabled }: AudioRecorderProps) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'paused' | 'preview'>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const initializingRef = useRef(false);
  const { toast } = useToast();

  const releaseMicrophone = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== 'closed') void contextRef.current.close().catch(() => {});
    contextRef.current = null;
    analyserRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      releaseMicrophone();
    };
  }, []);

  useEffect(() => {
    onActiveChange?.(phase !== 'idle' || isInitializing);
  }, [phase, isInitializing, onActiveChange]);

  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  useEffect(() => {
    if (!audioBlob) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(audioBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = setInterval(() => setRecordingTime(time => time + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    let frame: number;
    const samples = new Uint8Array(256);
    const draw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (phase === 'recording') analyserRef.current?.getByteTimeDomainData(samples);
        context.fillStyle = phase === 'paused' ? '#a4b1ad' : '#059669';
        for (let index = 0; index < 40; index++) {
          const amplitude = phase === 'paused' || !analyserRef.current ? 0 : Math.abs(samples[index * 6] - 128) / 128;
          const height = Math.min(30, Math.max(3, amplitude * 85));
          context.beginPath();
          context.roundRect(index * 6, (32 - height) / 2, 3, height, 1.5);
          context.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const startRecording = async () => {
    if (initializingRef.current || disabled) return;
    initializingRef.current = true;
    cancelledRef.current = false;
    setIsInitializing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Seu navegador não permite gravação de áudio. Use um navegador atualizado em uma conexão segura.');
      const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Seu navegador não suporta gravação em um formato compatível.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!mountedRef.current || cancelledRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        releaseMicrophone();
        if (cancelledRef.current || !mountedRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!blob.size) { setPhase('idle'); toast({ title: 'Nenhum áudio capturado', description: 'Tente gravar novamente.', variant: 'destructive' }); return; }
        setAudioBlob(blob);
        setPhase('preview');
      };
      recorder.onerror = () => {
        cancelledRef.current = true;
        releaseMicrophone();
        if (mountedRef.current) { setPhase('idle'); toast({ title: 'A gravação foi interrompida', description: 'Verifique seu microfone e tente novamente.', variant: 'destructive' }); }
      };
      // Visualization is optional: audio capture still works without Web Audio.
      try {
        const context = new AudioContext();
        contextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = analyser;
      } catch { /* Keep recording when visualization is unavailable. */ }
      setRecordingTime(0);
      recorder.start();
      setPhase('recording');
    } catch (error) {
      releaseMicrophone();
      if (mountedRef.current) toast({ title: 'Não foi possível iniciar a gravação', description: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Permita o acesso ao microfone no navegador para gravar sua mensagem.' : error instanceof Error ? error.message : 'Verifique seu microfone.', variant: 'destructive' });
    } finally {
      initializingRef.current = false;
      if (mountedRef.current) setIsInitializing(false);
    }
  };

  const discard = () => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    releaseMicrophone();
    setAudioBlob(null);
    setRecordingTime(0);
    setPhase('idle');
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') { recorder.pause(); setPhase('paused'); }
    else if (recorder?.state === 'paused') { recorder.resume(); setPhase('recording'); }
  };

  const send = async () => {
    if (!audioBlob || isSending) return;
    setIsSending(true);
    try { await onSend(audioBlob, recordingTime, audioBlob.type); if (mountedRef.current) discard(); }
    catch { if (mountedRef.current) toast({ title: 'Não foi possível enviar', description: 'Seu áudio foi mantido. Tente enviar novamente.', variant: 'destructive' }); }
    finally { if (mountedRef.current) setIsSending(false); }
  };

  if (phase === 'idle' && !isInitializing) return (
    <button type="button" onClick={startRecording} disabled={disabled} className={cn(styles.tool, styles.add)} aria-label="Gravar mensagem de voz" title="Gravar mensagem de voz"><Mic size={18} /></button>
  );

  return (
    <div className={styles.voice} aria-label="Gravador de mensagem de voz">
      <div className={styles.voiceHeader}>
        <strong>{phase === 'recording' ? <span className={styles.liveDot} /> : <Mic size={14} />}{isInitializing ? 'Conectando microfone…' : isSending ? 'Enviando seu áudio…' : phase === 'preview' ? 'Ouça antes de enviar' : phase === 'paused' ? 'Gravação pausada' : 'Gravando sua mensagem'}</strong>
        <span>{phase === 'preview' ? 'Prévia do áudio' : 'Áudio'}</span>
      </div>
      <div className={styles.voiceBody}>
        <button type="button" className={styles.recordButton} onClick={discard} disabled={isSending} aria-label="Descartar gravação" title="Descartar gravação"><Trash2 /></button>
        {phase === 'preview' && previewUrl ? <div className={styles.voicePreview}><RecordingPreview blob={audioBlob!} src={previewUrl} duration={recordingTime} disabled={isSending} /></div> : (
          <div className={styles.recordTrack}><time>{formatTime(recordingTime)}</time>{isInitializing ? <Loader2 className="h-4 w-4 animate-spin" /> : <canvas ref={canvasRef} width={240} height={32} aria-hidden="true" />}</div>
        )}
        {(phase === 'recording' || phase === 'paused') && <button type="button" className={styles.recordButton} onClick={togglePause} aria-label={phase === 'paused' ? 'Retomar gravação' : 'Pausar gravação'} title={phase === 'paused' ? 'Retomar' : 'Pausar'}>{phase === 'paused' ? <Play /> : <Pause />}</button>}
        {phase === 'preview' ? <button type="button" onClick={send} disabled={isSending} className={styles.send} aria-label="Enviar áudio" title="Enviar áudio">{isSending ? <Loader2 className="animate-spin" /> : <ArrowUp />}</button> : <button type="button" className={cn(styles.recordButton, styles.stop)} disabled={isInitializing} onClick={() => recorderRef.current?.stop()} aria-label="Parar e ouvir gravação" title="Parar e ouvir"><Square className="fill-current !h-3.5 !w-3.5" /></button>}
      </div>
    </div>
  );
}
