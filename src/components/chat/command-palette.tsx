'use client';

import * as React from "react";
import {
    Calculator,
    Calendar,
    CreditCard,
    Settings,
    Smile,
    User,
    Search,
    MessageSquare,
    LogOut,
    RefreshCw,
    Moon,
    Sun
} from "lucide-react";

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function CommandPalette() {
    const [open, setOpen] = React.useState(false);
    const router = useRouter();
    const { theme, setTheme } = useTheme();

    const chats = useInboxStore((state) => state.chats);
    const selectedChatId = useInboxStore((state) => state.selectedChatId);
    const setSelectedChatId = useInboxStore((state) => state.setSelectedChatId);
    const chatsByStatus = React.useMemo(() => {
        return {
            attending: chats.filter(c => c.status === 'atendimentos'),
            queue: chats.filter(c => c.status === 'gerais'),
            closed: chats.filter(c => c.status === 'encerrados')
        };
    }, [chats]);

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    const runCommand = React.useCallback((command: () => unknown) => {
        setOpen(false);
        command();
    }, []);

    return (
        <>
            <CommandDialog open={open} onOpenChange={setOpen}>
                <CommandInput placeholder="Digite um comando ou busque um chat..." />
                <CommandList>
                    <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

                    <CommandGroup heading="Atendimentos em Andamento">
                        {chatsByStatus.attending.map((chat) => (
                            <CommandItem
                                key={chat.id}
                                value={`${chat.contact?.name || 'Desconhecido'} ${chat.protocol || ''} ${chat.messages[chat.messages.length - 1]?.content || ''}`}
                                onSelect={() => {
                                    runCommand(() => {
                                        setSelectedChatId(chat.id);
                                    });
                                }}
                            >
                                <MessageSquare className="mr-2 h-4 w-4" />
                                <span>{chat.contact?.name || 'Desconhecido'}</span>
                                <span className="ml-auto text-xs text-muted-foreground">
                                    {chat.updatedAt ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true, locale: ptBR }) : ''}
                                </span>
                            </CommandItem>
                        ))}
                    </CommandGroup>

                    <CommandGroup heading="Fila de Espera">
                        {chatsByStatus.queue.map((chat) => (
                            <CommandItem
                                key={chat.id}
                                value={`${chat.contact?.name || 'Desconhecido'} ${chat.protocol || ''}`}
                                onSelect={() => runCommand(() => setSelectedChatId(chat.id))}
                            >
                                <User className="mr-2 h-4 w-4" />
                                <span>{chat.contact?.name || 'Desconhecido'}</span>
                                <span className="ml-auto text-xs text-muted-foreground">
                                    {chat.updatedAt ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true, locale: ptBR }) : ''}
                                </span>
                            </CommandItem>
                        ))}
                    </CommandGroup>

                    <CommandSeparator />

                    <CommandGroup heading="Ações">
                        <CommandItem onSelect={() => runCommand(() => window.location.reload())}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            <span>Recarregar Inbox</span>
                            <CommandShortcut>F5</CommandShortcut>
                        </CommandItem>
                        <CommandItem onSelect={() => runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))}>
                            {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                            <span>Alternar Tema</span>
                        </CommandItem>
                    </CommandGroup>
                </CommandList>
            </CommandDialog>
        </>
    );
}
