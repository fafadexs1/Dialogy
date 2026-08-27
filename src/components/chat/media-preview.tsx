

'use client';

import React from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { File as FileIcon, X, Video, Image as ImageIcon } from 'lucide-react';

export interface MediaFileType {
  id: string; // Unique ID for React key, e.g., `${file.name}-${file.lastModified}`
  file: File;
  name: string;
  type: string;
  base64: string;
  mediatype: 'image' | 'video' | 'document' | 'audio';
  thumbnail?: string; // Optional Base64 thumbnail for videos
}

interface MediaPreviewProps {
  mediaFiles: MediaFileType[];
  setMediaFiles: React.Dispatch<React.SetStateAction<MediaFileType[]>>;
}

export default function MediaPreview({ mediaFiles, setMediaFiles }: MediaPreviewProps) {
  const handleRemoveFile = (id: string) => {
    setMediaFiles(files => files.filter(file => file.id !== id));
  };

  const handleNameChange = (id: string, newName: string) => {
    setMediaFiles(files =>
      files.map(file => (file.id === id ? { ...file, name: newName } : file))
    );
  };

  const getFileIcon = (mediatype: MediaFileType['mediatype']) => {
    switch (mediatype) {
      case 'image':
        return <ImageIcon className="h-8 w-8 text-primary/70" />;
      case 'video':
        return <Video className="h-8 w-8 text-primary/70" />;
      default:
        return <FileIcon className="h-8 w-8 text-primary/70" />;
    }
  };

  return (
    <div className="w-full relative group/scroll">
      <ScrollArea className="w-full whitespace-nowrap rounded-xl border border-border/40 bg-background/20 backdrop-blur-sm pb-2">
        <div className="flex w-max space-x-3 p-3">
          {mediaFiles.map(file => (
            <div
              key={file.id}
              className="relative group flex flex-col w-36 h-40 flex-shrink-0 rounded-xl border border-border bg-background/50 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 hover:ring-2 hover:ring-primary/20"
            >
              {/* Preview Area */}
              <div className="relative h-24 w-full bg-secondary/30 flex items-center justify-center overflow-hidden">
                {file.mediatype === 'image' || (file.mediatype === 'video' && file.thumbnail) ? (
                  <Image
                    src={file.thumbnail || URL.createObjectURL(file.file)}
                    alt={file.name}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                    onLoad={e => { if (file.mediatype === 'image') URL.revokeObjectURL(e.currentTarget.src) }}
                  />
                ) : (
                  <div className="transform transition-transform duration-300 group-hover:scale-110">
                    {getFileIcon(file.mediatype)}
                  </div>
                )}

                {/* Remove Button (Overlay) */}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-md rounded-full"
                  onClick={() => handleRemoveFile(file.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {/* Footer Info */}
              <div className="flex-1 p-2 flex flex-col justify-between bg-background/60 backdrop-blur-md">
                <Input
                  value={file.name}
                  onChange={e => handleNameChange(file.id, e.target.value)}
                  className="h-6 text-[10px] px-1 bg-transparent border-transparent hover:border-border focus:border-border focus:bg-background transition-colors truncate"
                  title={file.name}
                />
                <div className="flex items-center justify-between px-1 mt-1">
                  <span className="text-[9px] text-muted-foreground uppercase font-medium tracking-wider">
                    {file.mediatype}
                  </span>
                  <span className="text-[9px] text-muted-foreground tabular-nums">
                    {(file.file.size / 1024).toFixed(0)}KB
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="opacity-0 group-hover/scroll:opacity-100 transition-opacity" />
      </ScrollArea>
    </div>
  );
}
