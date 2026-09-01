'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import styles from './composer.module.css';

const timeLabel = (time: number) => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;

/** Draft audio controls, separate from delivered messages and transcription. */
export function RecordingPreview({ blob, src, duration, disabled }: {
  blob: Blob;
  src: string;
  duration: number;
  disabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(duration);
  const [error, setError] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(56).fill(0.12));

  useEffect(() => {
    let cancelled = false;
    let context: AudioContext | undefined;
    const decode = async () => {
      try {
        context = new AudioContext();
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        if (cancelled) return;
        const samples = buffer.getChannelData(0);
        const peaks = Array.from({ length: 56 }, (_, index) => {
          const start = Math.floor(index * samples.length / 56);
          const end = Math.floor((index + 1) * samples.length / 56);
          let sum = 0;
          for (let offset = start; offset < end; offset++) sum += samples[offset] ** 2;
          return Math.sqrt(sum / Math.max(1, end - start));
        });
        const max = Math.max(...peaks, 0.001);
        setLevels(peaks.map(peak => Math.max(0.1, peak / max)));
        setLength(buffer.duration);
      } catch { /* A neutral track remains usable when waveform decoding is unavailable. */ }
      finally { if (context?.state !== 'closed') void context?.close().catch(() => {}); }
    };
    void decode();
    return () => {
      cancelled = true;
      if (context?.state !== 'closed') void context?.close().catch(() => {});
    };
  }, [blob]);

  useEffect(() => {
    if (disabled) audioRef.current?.pause();
  }, [disabled]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    setLoading(true);
    setError(false);
    try { await audio.play(); }
    catch { setError(true); }
    finally { setLoading(false); }
  };

  return (
    <div className={styles.draftAudio}>
      <audio ref={audioRef} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setLength(event.currentTarget.duration); }}
      />
      <button type="button" onClick={togglePlayback} disabled={disabled} className={styles.draftPlay} aria-label={playing ? 'Pausar prévia do áudio' : 'Ouvir prévia do áudio'}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : playing ? <Pause size={15} className="fill-current" /> : <Play size={15} className="fill-current" />}
      </button>
      <div className={styles.draftWaveform}>
        <div aria-hidden="true">{levels.map((level, index) => <span key={index} data-played={position > 0 && index / levels.length <= position / length} style={{ height: `${level * 100}%` }} />)}</div>
        <input type="range" min={0} max={length || 1} step={0.01} value={Math.min(position, length)} disabled={disabled || !length}
          aria-label="Posição da prévia do áudio" aria-valuetext={`${timeLabel(position)} de ${timeLabel(length)}`}
          onChange={event => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setPosition(next); }} />
      </div>
      <time className={styles.draftTime}>{error ? 'Erro ao ouvir' : timeLabel(playing || position > 0 ? position : length)}</time>
    </div>
  );
}
