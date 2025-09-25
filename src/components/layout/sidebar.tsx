
'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Users,
  Settings,
  BarChart2,
  LogOut,
  User as UserIcon,
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
  Monitor,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuTrigger,
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
  { href: '/', icon: MessageSquare, label: 'Chat' },
  { href: '/crm', icon: Users, label: 'CRM' },
  { href: '/campaigns', icon: Send, label: 'Campanhas' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/integrations', icon: Puzzle, label: 'Integrações' },
];

const teamNavItems = [
    { href: '/team/members', icon: Users2, label: 'Membros' },
    { href: '/team', icon: ShieldAlert, label: 'Equipes' },
    { href: '/team/permissions', icon: Fingerprint, label: 'Papéis & Permissões' },
]

const automationNavItems = [
    { href: '/automations/robots', icon: Rocket, label: 'Agentes do Sistema' },
    { href: '/autopilot', icon: Bot, label: 'Agente de IA' },
]

function DialogyLogo() {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
        >
            <path
            d="M19.1691 5.48011C20.9416 7.61461 22.0001 10.2227 22.0001 13.0001C22.0001 18.068 18.0681 22.0001 13.0001 22.0001C10.2227 22.0001 7.61467 20.9416 5.48011 19.1691C3.34561 17.4046 2.08092 14.8878 2.00511 12.1191C1.98633 11.4583 2.50275 10.9234 3.16011 10.9386C3.4116 10.9441 3.65582 11.0454 3.83272 11.2224C6.51111 13.9007 10.7416 14.2256 13.7887 12.012C16.8358 9.79841 17.8251 5.61711 15.8691 2.52011C15.6582 2.19302 15.7196 1.76451 15.993 1.50371C16.3241 1.20011 16.8126 1.16841 17.1816 1.41161C19.7891 3.03611 20.6691 6.13661 19.1691 8.87711"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            />
            <path
            d="M7.49989 12.0001L10.3299 14.8301L15.9999 9.17011"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            />
        </svg>
    )
}

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
    <aside className="flex h-full w-20 flex-col items-center justify-between border-r bg-card p-4">
        <div className="flex flex-col items-center gap-6">
            <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground">
                <DialogyLogo />
                <span className="sr-only">Dialogy</span>
            </Link>
            
            <WorkspaceSwitcher user={user} />

            <nav className="flex flex-col items-center gap-4">
                <TooltipProvider>
                    {mainNavItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Tooltip key={item.label}>
                                <TooltipTrigger asChild>
                                <Link
                                    href={item.href}
                                    className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors
                                    ${
                                        isActive
                                        ? 'bg-foreground text-background'
                                        : 'text-muted-foreground hover:bg-muted'
                                    }`}
                                >
                                    <item.icon className="h-6 w-6" />
                                </Link>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                <p>{item.label}</p>
                                </TooltipContent>
                            </Tooltip>
                        );
                    })}

                    {/* Team Submenu */}
                    <DropdownMenu>
                         <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <button className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors
                                        ${
                                            pathname.startsWith('/team')
                                            ? 'bg-foreground text-background'
                                            : 'text-muted-foreground hover:bg-muted'
                                        }`}
                                    >
                                        <Users2 className="h-6 w-6" />
                                    </button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                             <TooltipContent side="right">
                                <p>Equipe</p>
                            </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent side="right">
                            <DropdownMenuLabel>Gestão de Equipes</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {teamNavItems.map(item => (
                                <Link key={item.href} href={item.href}>
                                    <DropdownMenuItem>
                                        <item.icon className="mr-2 h-4 w-4" />
                                        <span>{item.label}</span>
                                    </DropdownMenuItem>
                                </Link>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                     {/* Automation Submenu */}
                    <DropdownMenu>
                         <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <button className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors
                                        ${
                                            pathname.startsWith('/automations') || pathname.startsWith('/autopilot')
                                            ? 'bg-foreground text-background'
                                            : 'text-muted-foreground hover:bg-muted'
                                        }`}
                                    >
                                        <Bot className="h-6 w-6" />
                                    </button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                             <TooltipContent side="right">
                                <p>Automações</p>
                            </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent side="right">
                            <DropdownMenuLabel>Automações & IA</DropdownMenuLabel>
                             <DropdownMenuSeparator />
                            {automationNavItems.map(item => (
                                <Link key={item.href} href={item.href}>
                                    <DropdownMenuItem>
                                        <item.icon className="mr-2 h-4 w-4" />
                                        <span>{item.label}</span>
                                    </DropdownMenuItem>
                                </Link>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                </TooltipProvider>
            </nav>
        </div>

        <div className="flex flex-col items-center gap-4">
            <DropdownMenu>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <button>
                                    <Avatar className="cursor-pointer h-12 w-12 border-2 border-primary/50">
                                        <AvatarImage src={user.avatar} alt={user.name} data-ai-hint="person male" />
                                        <AvatarFallback>{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                </button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>
                         <TooltipContent side="right">
                            <p>{user.name}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <DropdownMenuContent side="right">
                    <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <Link href="/settings/profile">
                        <DropdownMenuItem>
                            <UserIcon className="mr-2 h-4 w-4" />
                            <span>Perfil</span>
                        </DropdownMenuItem>
                    </Link>
                    <Link href="/settings">
                        <DropdownMenuItem>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Configurações</span>
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
