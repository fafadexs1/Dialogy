
'use client';

import React from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { File as FileIcon, X, Video, Image as ImageIcon } from 'lucide-react';

export interface MediaFileType {
  id: string; // Unique ID for React key, e.g., `${file.name}-${file.lastModified}`
  file: File;
  name: string;
  type: string;
  base64: string;
  mediatype: 'image' | 'video' | 'document';
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
        return <ImageIcon className="h-8 w-8 text-muted-foreground" />;
      case 'video':
        return <Video className="h-8 w-8 text-muted-foreground" />;
      default:
        return <FileIcon className="h-8 w-8 text-muted-foreground" />;
    }
  };

  return (
    <Card className="mb-2 p-2 border-dashed">
      <ScrollArea className="h-40">
        <div className="p-2 space-y-3">
          {mediaFiles.map(file => (
            <div key={file.id} className="flex items-center gap-3 p-2 border rounded-lg bg-background">
              <div className="flex-shrink-0 h-12 w-12 rounded-md bg-secondary flex items-center justify-center overflow-hidden">
                {file.mediatype === 'image' ? (
                  <Image
                    src={URL.createObjectURL(file.file)}
                    alt={file.name}
                    width={48}
                    height={48}
                    className="object-cover h-full w-full"
                    onLoad={e => URL.revokeObjectURL(e.currentTarget.src)}
                  />
                ) : (
                  getFileIcon(file.mediatype)
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <Input
                  value={file.name}
                  onChange={e => handleNameChange(file.id, e.target.value)}
                  className="h-7 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {(file.file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleRemoveFile(file.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
