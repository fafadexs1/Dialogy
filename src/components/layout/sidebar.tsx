

'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Users,
  Settings,
  BarChart2,
  LifeBuoy,
  LogOut,
  User as UserIcon,
  Slack,
  Puzzle,
  Bot,
  Building,
  UserPlus,
  Users2,
  ShieldAlert,
  Fingerprint,
  Rocket,
  Send,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import type { User } from '@/lib/types';
import { usePathname, useRouter } from 'next/navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import { createClient } from '@/lib/supabase/client';
import React, { useEffect, useState } from 'react';

interface SidebarProps {
  user: User;
}

const mainNavItems = [
  { href: '/', icon: MessageSquare, label: 'Central de Atendimento' },
  { href: '/crm', icon: Users, label: 'CRM 360º' },
  { href: '/campaigns', icon: Send, label: 'Campanhas' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/integrations', icon: Puzzle, label: 'Integrações' },
];

function ThemeSwitcher() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'system'
    }
    return 'system'
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
            {theme === 'light' && <Sun className="mr-2 h-4 w-4" />}
            {theme === 'dark' && <Moon className="mr-2 h-4 w-4" />}
            {theme === 'system' && <Monitor className="mr-2 h-4 w-4" />}
            <span>Tema</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
            <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme('light')}>
                    <Sun className="mr-2 h-4 w-4" />
                    <span>Claro</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                    <Moon className="mr-2 h-4 w-4" />
                    <span>Escuro</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')}>
                    <Monitor className="mr-2 h-4 w-4" />
                    <span>Sistema</span>
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

function SignOutMenuItem({ userId }: { userId: string }) {
    const router = useRouter();
    const handleSignOut = async () => {
        const supabase = createClient();
        const { error } = await supabase.auth.signOut();
        if (!error) {
            router.push('/login');
        }
    }

    return (
        <DropdownMenuItem onSelect={(e) => {
            e.preventDefault();
            handleSignOut();
        }}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sair</span>
        </DropdownMenuItem>
    );
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-auto flex-col justify-between border-r bg-card p-2">
      <div className="flex flex-col items-center gap-4">
        <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LifeBuoy className="h-6 w-6" />
          <span className="sr-only">Dialogy</span>
        </Link>
        
        {user.activeWorkspaceId && (
            <WorkspaceSwitcher user={user} />
        )}
        <Separator />

        <nav className="flex flex-col items-center gap-2">
          <TooltipProvider>
            {mainNavItems.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                      ${
                        pathname.startsWith(item.href) && (item.href !== '/' || pathname === '/')
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                  >
                    <item.icon className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            ))}

            <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                             <button
                                className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                                ${
                                    pathname.startsWith('/autopilot') || pathname.startsWith('/automations')
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                }`}
                              >
                                <Bot className="h-5 w-5" />
                              </button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Automações</p>
                    </TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right">
                    <DropdownMenuLabel>Automações</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <Link href="/autopilot">
                        <DropdownMenuItem>
                            <Bot className="mr-2 h-4 w-4" />
                            <span>Piloto Automático</span>
                        </DropdownMenuItem>
                    </Link>
                     <Link href="/automations/robots">
                        <DropdownMenuItem>
                            <Rocket className="mr-2 h-4 w-4" />
                            <span>Agentes do Sistema</span>
                        </DropdownMenuItem>
                    </Link>
                </DropdownMenuContent>
            </DropdownMenu>

             <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                             <button
                                className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                                ${
                                    pathname.startsWith('/team')
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                }`}
                              >
                                <Slack className="h-5 w-5" />
                              </button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>Equipes e Membros</p>
                    </TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right">
                    <DropdownMenuLabel>Equipes e Membros</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <Link href="/team">
                        <DropdownMenuItem>
                            <Users2 className="mr-2 h-4 w-4" />
                            <span>Gerenciar Equipes</span>
                        </DropdownMenuItem>
                    </Link>
                     <Link href="/team/invite">
                        <DropdownMenuItem>
                            <UserPlus className="mr-2 h-4 w-4" />
                            <span>Convidar Membros</span>
                        </DropdownMenuItem>
                    </Link>
                     <Link href="/team/members">
                        <DropdownMenuItem>
                            <ShieldAlert className="mr-2 h-4 w-4" />
                            <span>Gerenciar Membros</span>
                        </DropdownMenuItem>
                    </Link>
                     <Link href="/team/permissions">
                        <DropdownMenuItem>
                            <Fingerprint className="mr-2 h-4 w-4" />
                            <span>Papéis & Permissões</span>
                        </DropdownMenuItem>
                    </Link>
                </DropdownMenuContent>
            </DropdownMenu>


          </TooltipProvider>
        </nav>
      </div>
      <div className="flex flex-col items-center gap-2">
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button>
                <Avatar className="cursor-pointer">
                    <AvatarImage src={user.avatar} alt={user.name} data-ai-hint="person male" />
                    <AvatarFallback>{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right">
            <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/settings/profile">
                <DropdownMenuItem>
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Perfil</span>
                </DropdownMenuItem>
            </Link>
             <Link href="/settings/workspace">
                <DropdownMenuItem>
                    <Building className="mr-2 h-4 w-4" />
                    <span>Configurações do Workspace</span>
                </DropdownMenuItem>
            </Link>
            <ThemeSwitcher />
            <DropdownMenuSeparator />
            <SignOutMenuItem userId={user.id} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function Separator() {
    return <div className="w-full h-px bg-border my-2" />
}
