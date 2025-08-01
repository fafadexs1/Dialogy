'use client';

import { useState } from 'react';
import { summarizeChat } from '@/ai/flows/chat-summarization';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Loader2, BookText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ChatSummaryProps {
  chatHistory: string;
}

export default function ChatSummary({ chatHistory }: ChatSummaryProps) {
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleSummarize = async () => {
    if (summary) {
        setIsOpen(true);
        return;
    }

    setIsLoading(true);
    setIsOpen(true);
    try {
      const result = await summarizeChat({ chatHistory });
      setSummary(result.summary);
    } catch (error) {
      console.error('Error summarizing chat:', error);
      toast({
        title: 'Erro ao resumir',
        description: 'Não foi possível gerar o resumo do chat. Tente novamente.',
        variant: 'destructive',
      });
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" onClick={handleSummarize} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookText className="h-5 w-5" />}
            <span className="sr-only">Summarize Chat</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Resumo do Chat</SheetTitle>
          <SheetDescription>
            Este é um resumo gerado por IA dos pontos-chave da conversa.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {isLoading && !summary ? (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
