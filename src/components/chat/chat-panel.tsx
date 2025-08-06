'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Paperclip, Send, Smile, MoreVertical, Bot, Loader2 } from 'lucide-react';
import { type Chat, type Message, type User } from '@/lib/types';
import { agents, nexusFlowInstances } from '@/lib/mock-data';
import SmartReplies from './smart-replies';
import ChatSummary from './chat-summary';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';

interface ChatPanelProps {
  chat: Chat;
  messages: Message[];
}

const mockKnowledgeBase = `
Política de Devolução: Nossa política de devolução permite que os clientes retornem produtos em até 30 dias após a compra, desde que o produto esteja em sua embalagem original e sem sinais de uso. O cliente deve apresentar o recibo original. Para produtos com defeito, a troca é garantida em até 90 dias.

FAQ - Horário de Funcionamento: Nosso horário de atendimento padrão é de segunda a sexta-feira, das 9h às 18h (horário de Brasília). Não funcionamos em feriados nacionais.
`;

export default function ChatPanel({ chat, messages }: ChatPanelProps) {
  const [newMessage, setNewMessage] = React.useState('');
  const [isAiAgentActive, setIsAiAgentActive] = React.useState(false);
  const [isAiThinking, setIsAiThinking] = React.useState(false);
  // This would typically come from a global state or settings context
  const [selectedAiModel, setSelectedAiModel] = React.useState('googleai/gemini-2.0-flash');
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const supabase = createClient();

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() === '') return;

    // In a real app, you'd get the current authenticated user's ID
    const senderId = chat.agent?.id || agents[0].id; 
    
    const { error } = await supabase
      .from('messages')
      .insert([
        { 
          content: newMessage,
          chat_id: chat.id,
          sender_id: senderId,
          sender_type: 'agent' // Assuming the user of this panel is always an agent
        }
      ]);
      
    if (error) {
        toast({
            title: 'Erro ao enviar mensagem',
            description: 'Não foi possível enviar sua mensagem. Tente novamente.',
            variant: 'destructive',
        });
    } else {
        setNewMessage('');
    }
  };

  React.useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [messages]);

  const chatHistoryForAI = messages.map(m => `${m.sender.name}: ${m.content}`).join('\n');
  const lastCustomerMessage = messages.filter(m => m.sender.id.startsWith('contact')).pop();

  React.useEffect(() => {
    const runAiAgent = async () => {
        if (isAiAgentActive && lastCustomerMessage && lastCustomerMessage.sender.id.startsWith('contact')) {
            const lastMessageInState = messages[messages.length - 1];
            if (lastMessageInState.sender.id === lastCustomerMessage.sender.id) {
                setIsAiThinking(true);
                try {
                    // Fetch active automation rules
                    const activeRules = nexusFlowInstances.filter(rule => rule.enabled);

                    const result = await generateAgentResponse({
                        customerMessage: lastCustomerMessage.content,
                        chatHistory: chatHistoryForAI,
                        rules: activeRules,
                        knowledgeBase: mockKnowledgeBase,
                        model: selectedAiModel,
                    });
                    
                    // Only respond if the AI returned a response (meaning a rule was triggered)
                    if (result && result.response) {
                        const senderId = chat.agent?.id || agents[0].id;
                        const { error } = await supabase
                          .from('messages')
                          .insert([
                            { 
                              content: result.response,
                              chat_id: chat.id,
                              sender_id: senderId, // AI responds as the agent
                              sender_type: 'agent'
                            }
                          ]);
                        if(error) throw error;
                    }

                } catch (error) {
                     console.error('Error generating AI agent response:', error);
                     toast({
                        title: 'Erro do Agente IA',
                        description: 'Não foi possível avaliar as regras de automação. Tente novamente.',
                        variant: 'destructive',
                    });
                } finally {
                    setIsAiThinking(false);
                }
            }
        }
    };
    runAiAgent();
  }, [messages, isAiAgentActive, lastCustomerMessage, chatHistoryForAI, toast, selectedAiModel, chat, supabase]);

  return (
    <main className="flex-1 flex flex-col bg-muted/20 min-w-0">
      <header className="flex h-16 items-center justify-between border-b bg-card px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border">
            <AvatarImage src={chat.contact.avatar} alt={chat.contact.name} data-ai-hint="person" />
            <AvatarFallback>{chat.contact.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <h2 className="font-semibold">{chat.contact.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <ChatSummary chatHistory={chatHistoryForAI} />
          <Button variant="ghost" size="icon">
              <MoreVertical className="h-5 w-5"/>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" >
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="space-y-6 p-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-end gap-3 animate-in fade-in ${
                  message.sender.id.startsWith('agent') ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={message.sender.avatar} alt={message.sender.name} data-ai-hint="person" />
                  <AvatarFallback>{message.sender.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div
                  className={`max-w-xl rounded-xl px-4 py-3 text-sm shadow-md ${
                    message.sender.id.startsWith('agent')
                      ? 'rounded-br-none bg-primary text-primary-foreground'
                      : 'rounded-bl-none bg-card'
                  }`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
             {isAiThinking && (
                <div className="flex items-end gap-3 flex-row-reverse animate-in fade-in">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={chat.agent?.avatar} alt={chat.agent?.name} data-ai-hint="person" />
                      <AvatarFallback>{chat.agent?.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="max-w-xl rounded-xl px-4 py-3 text-sm shadow-md rounded-br-none bg-primary text-primary-foreground">
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Avaliando regras...</span>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <footer className="border-t bg-card p-4 flex-shrink-0">
        {!isAiAgentActive && (
            <SmartReplies 
                customerMessage={lastCustomerMessage?.content || ''}
                chatHistory={chatHistoryForAI}
                onSelectReply={(reply) => setNewMessage(reply)}
            />
        )}
        <div className="flex items-center gap-4 mt-2">
            <form onSubmit={handleSendMessage} className="relative flex-1">
                <Input
                    placeholder="Digite sua mensagem..."
                    className="pr-24"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    disabled={isAiAgentActive}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                    <Button type="button" variant="ghost" size="icon" disabled={isAiAgentActive}><Smile className="h-5 w-5" /></Button>
                    <Button type="button" variant="ghost" size="icon" disabled={isAiAgentActive}><Paperclip className="h-5 w-5" /></Button>
                    <Button type="submit" size="sm" className='h-8' disabled={isAiAgentActive}>
                    <Send className="h-4 w-4" />
                    </Button>
                </div>
            </form>
            <div className="flex items-center space-x-2">
                <Bot className="h-5 w-5 text-muted-foreground" />
                <Switch
                    id="ai-agent-switch"
                    checked={isAiAgentActive}
                    onCheckedChange={setIsAiAgentActive}
                />
                <Label htmlFor="ai-agent-switch" className="font-medium text-sm">Piloto Automático</Label>
            </div>
        </div>
      </footer>
    </main>
  );
}
