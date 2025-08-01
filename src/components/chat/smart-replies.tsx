'use client';

import { useState, useEffect, useRef } from 'react';
import { generateSmartReplies } from '@/ai/flows/smart-replies';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';

interface SmartRepliesProps {
  customerMessage: string;
  chatHistory: string;
  onSelectReply: (reply: string) => void;
}

export default function SmartReplies({ customerMessage, chatHistory, onSelectReply }: SmartRepliesProps) {
  const [replies, setReplies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastMessageRef = useRef(customerMessage);

  useEffect(() => {
    const fetchReplies = async () => {
      if (!customerMessage || lastMessageRef.current === customerMessage) return;
      
      lastMessageRef.current = customerMessage;
      setIsLoading(true);
      setReplies([]);
      try {
        const result = await generateSmartReplies({ customerMessage, chatHistory });
        setReplies(result.suggestedReplies);
      } catch (error) {
        console.error('Error generating smart replies:', error);
        setReplies([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReplies();
  }, [customerMessage, chatHistory]);

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
    <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-2">
        <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
        {replies.map((reply, index) => (
            <Button
            key={index}
            variant="outline"
            size="sm"
            onClick={() => onSelectReply(reply)}
            className="whitespace-nowrap bg-accent/50 hover:bg-accent"
            >
            {reply}
            </Button>
        ))}
    </div>
  );
}
