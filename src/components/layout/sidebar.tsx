
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
    CreditCard,
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
import { usePathname } from 'next/navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import React, { useEffect, useState, useTransition } from 'react';
import { signOut } from '@/actions/auth';

interface SidebarProps {
    user: User;
}

const mainNavItems = [
    { href: '/inbox', icon: MessageSquare, label: 'Chat' },
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

function SignOutMenuItem({ user }: { user: User }) {
    const [isPending, startTransition] = useTransition();

    const handleSignOut = () => {
        startTransition(async () => {
            if (user.activeWorkspaceId) {
                try {
                    await fetch('/api/users/online-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workspaceId: user.activeWorkspaceId, isOnline: false }),
                    });
                } catch (error) {
                    console.error("Error setting offline status:", error);
                }
            }
            await signOut();
        });
    };

    return (
        <DropdownMenuItem
            disabled={isPending}
            onSelect={(e) => {
                e.preventDefault();
                handleSignOut();
            }}
            className="focus:bg-white/10 focus:text-white cursor-pointer text-red-400 focus:text-red-300"
        >
            <LogOut className="mr-2 h-4 w-4" />
            <span>{isPending ? 'Saindo...' : 'Sair'}</span>
        </DropdownMenuItem>
    );
}

export function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();

    return (
        <aside className="flex h-full w-20 flex-col items-center bg-zinc-950 p-4 z-50 relative">
            {/* Top Section */}
            <div className="flex flex-col items-center gap-6 flex-shrink-0">
                <Link href="/inbox" className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all duration-300">
                    <DialogyLogo />
                    <span className="sr-only">Dialogy</span>
                </Link>
                <WorkspaceSwitcher user={user} />
            </div>

            {/* Middle Section (Navigation) */}
            <div className="flex flex-1 items-center justify-center my-4">
                <nav className="flex flex-col items-center gap-4">
                    <TooltipProvider>
                        {mainNavItems.map((item) => {
                            const isActive = pathname.startsWith(item.href) && (item.href !== '/' || pathname === '/');
                            if (item.href === '/' && pathname.startsWith('/inbox')) {
                                // special case because inbox is the new home
                            }
                            return (
                                <Tooltip key={item.label}>
                                    <TooltipTrigger asChild>
                                        <Link
                                            href={item.href}
                                            className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 group relative
                                    ${isActive
                                                    ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20'
                                                    : 'text-white/50 hover:bg-white/10 hover:text-white'
                                                }`}
                                        >
                                            {isActive && (
                                                <div className="absolute inset-0 rounded-2xl bg-white/20 blur-md opacity-50" />
                                            )}
                                            <item.icon className={`h-5 w-5 relative z-10 ${isActive ? 'text-white' : ''}`} />
                                        </Link>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="bg-zinc-950 border-white/10 text-white font-medium shadow-xl">
                                        <p>{item.label}</p>
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}

                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <button className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 group relative
                                        ${pathname.startsWith('/team')
                                                ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20'
                                                : 'text-white/50 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            {pathname.startsWith('/team') && (
                                                <div className="absolute inset-0 rounded-2xl bg-white/20 blur-md opacity-50" />
                                            )}
                                            <Users2 className={`h-5 w-5 relative z-10 ${pathname.startsWith('/team') ? 'text-white' : ''}`} />
                                        </button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="bg-zinc-950 border-white/10 text-white font-medium shadow-xl">
                                    <p>Equipe</p>
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent side="right" className="bg-zinc-950 border-white/10 text-white w-56 shadow-xl">
                                <DropdownMenuLabel className="text-muted-foreground">Gestão de Equipes</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-white/10" />
                                {teamNavItems.map(item => (
                                    <Link key={item.href} href={item.href}>
                                        <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer">
                                            <item.icon className="mr-2 h-4 w-4 text-blue-400" />
                                            <span>{item.label}</span>
                                        </DropdownMenuItem>
                                    </Link>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <button className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 group relative
                                        ${pathname.startsWith('/automations') || pathname.startsWith('/autopilot')
                                                ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20'
                                                : 'text-white/50 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            {(pathname.startsWith('/automations') || pathname.startsWith('/autopilot')) && (
                                                <div className="absolute inset-0 rounded-2xl bg-white/20 blur-md opacity-50" />
                                            )}
                                            <Bot className={`h-5 w-5 relative z-10 ${(pathname.startsWith('/automations') || pathname.startsWith('/autopilot')) ? 'text-white' : ''}`} />
                                        </button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="bg-zinc-950 border-white/10 text-white font-medium shadow-xl">
                                    <p>Automações</p>
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent side="right" className="bg-zinc-950 border-white/10 text-white w-56 shadow-xl">
                                <DropdownMenuLabel className="text-muted-foreground">Automações & IA</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-white/10" />
                                {automationNavItems.map(item => (
                                    <Link key={item.href} href={item.href}>
                                        <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer">
                                            <item.icon className="mr-2 h-4 w-4 text-blue-400" />
                                            <span>{item.label}</span>
                                        </DropdownMenuItem>
                                    </Link>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                    </TooltipProvider>
                </nav>
            </div>

            {/* Bottom Section */}
            <div className="flex flex-col items-center gap-4 flex-shrink-0">
                <DropdownMenu>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <button className="relative group">
                                        <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-full opacity-75 group-hover:opacity-100 blur transition duration-200"></div>
                                        <Avatar className="cursor-pointer h-10 w-10 border-2 border-black relative">
                                            <AvatarImage src={user.avatar} alt={user.name} data-ai-hint="person male" />
                                            <AvatarFallback className="bg-zinc-900 text-white">{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                    </button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="bg-zinc-950 border-white/10 text-white font-medium shadow-xl">
                                <p>{user.name}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <DropdownMenuContent side="right" className="bg-zinc-950 border-white/10 text-white w-56 mb-2 shadow-xl">
                        <DropdownMenuLabel className="text-muted-foreground">{user.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <Link href="/settings/profile">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer">
                                <UserIcon className="mr-2 h-4 w-4 text-blue-400" />
                                <span>Perfil</span>
                            </DropdownMenuItem>
                        </Link>
                        <Link href="/settings/billing">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer">
                                <CreditCard className="mr-2 h-4 w-4 text-blue-400" />
                                <span>Cobrança & Faturas</span>
                            </DropdownMenuItem>
                        </Link>
                        <Link href="/settings">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer">
                                <Settings className="mr-2 h-4 w-4 text-blue-400" />
                                <span>Configurações</span>
                            </DropdownMenuItem>
                        </Link>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <SignOutMenuItem user={user} />
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
}
