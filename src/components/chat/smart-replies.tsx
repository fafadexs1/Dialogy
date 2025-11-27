
'use client';

import { useState, useEffect, useRef } from 'react';
import { generateSmartReplies } from '@/ai/flows/smart-replies';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';

interface SmartRepliesProps {
  customerMessage: string;
  chatHistory: string;
  workspaceId: string;
  onSelectReply: (reply: string) => void;
}

const replyCache = new Map<string, string[]>();
const MAX_CACHE_SIZE = 50;

export default function SmartReplies({ customerMessage, chatHistory, workspaceId, onSelectReply }: SmartRepliesProps) {
  const [replies, setReplies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastMessageRef = useRef('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      if (e.deltaY !== 0) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  useEffect(() => {
    const fetchReplies = async () => {
      if (!customerMessage || lastMessageRef.current === customerMessage) return;

      // Check cache first
      if (replyCache.has(customerMessage)) {
        setReplies(replyCache.get(customerMessage)!);
        lastMessageRef.current = customerMessage;
        return;
      }

      lastMessageRef.current = customerMessage;
      setIsLoading(true);
      setReplies([]);
      try {
        const result = await generateSmartReplies({ customerMessage, chatHistory, workspaceId });

        // Update cache
        if (replyCache.size >= MAX_CACHE_SIZE) {
          const firstKey = replyCache.keys().next().value;
          if (firstKey) replyCache.delete(firstKey);
        }
        replyCache.set(customerMessage, result.suggestedReplies);

        setReplies(result.suggestedReplies);
      } catch (error) {
        console.error('Error generating smart replies:', error);
        setReplies([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReplies();
  }, [customerMessage, chatHistory, workspaceId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground h-9">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Gerando respostas...</span>
      </div>
    );
  }

  if (replies.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mb-2 max-w-full">
      <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar mask-gradient-right flex-1"
      >
        {replies.map((reply, index) => (
          <Button
            key={index}
            variant="outline"
            size="sm"
            onClick={() => onSelectReply(reply)}
            className="whitespace-nowrap bg-accent/50 hover:bg-accent flex-shrink-0"
          >
            {reply}
          </Button>
        ))}
      </div>
    </div>
  );
}