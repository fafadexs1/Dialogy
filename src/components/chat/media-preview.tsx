'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { FileText, X, Video, Image as ImageIcon, AudioLines } from 'lucide-react';
import styles from './composer.module.css';

export interface MediaFileType {
  id: string;
  file: File;
  name: string;
  type: string;
  base64: string;
  mediatype: 'image' | 'video' | 'document' | 'audio';
  thumbnail?: string;
}

interface MediaPreviewProps {
  mediaFiles: MediaFileType[];
  setMediaFiles: React.Dispatch<React.SetStateAction<MediaFileType[]>>;
}

function Attachment({ item, onRemove, onRename }: { item: MediaFileType; onRemove: () => void; onRename: (name: string) => void }) {
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    if (item.mediatype !== 'image') return;
    const url = URL.createObjectURL(item.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file, item.mediatype]);
  const Icon = { image: ImageIcon, video: Video, document: FileText, audio: AudioLines }[item.mediatype];
  const labels = { image: 'Imagem', video: 'Vídeo', document: 'Documento', audio: 'Áudio' };
  const size = item.file.size >= 1024 * 1024 ? `${(item.file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(item.file.size / 1024))} KB`;
  const src = item.thumbnail || previewUrl;
  return (
    <div className={styles.attachment}>
      <div className={styles.thumbnail} data-type={item.mediatype}>
        {src ? <Image src={src} alt={item.name} width={44} height={48} unoptimized /> : <Icon size={23} strokeWidth={1.5} />}
      </div>
      <div className={styles.fileInfo}>
        <input value={item.name} onChange={event => onRename(event.target.value)} aria-label={`Nome do arquivo ${item.name}`} title={item.name} />
        <p>{labels[item.mediatype]} · {size}</p>
      </div>
      <button type="button" className={styles.removeFile} onClick={onRemove} aria-label={`Remover ${item.name}`}><X size={13} /></button>
    </div>
  );
}

export default function MediaPreview({ mediaFiles, setMediaFiles }: MediaPreviewProps) {
  return (
    <div className={styles.attachments} aria-label="Arquivos para enviar">
      {mediaFiles.map(item => <Attachment key={item.id} item={item}
        onRemove={() => setMediaFiles(files => files.filter(file => file.id !== item.id))}
        onRename={name => setMediaFiles(files => files.map(file => file.id === item.id ? { ...file, name } : file))}
      />)}
    </div>
  );
}
