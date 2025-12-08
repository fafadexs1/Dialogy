
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
    HelpCircle,
    ChevronRight,
    LucideIcon
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
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';

interface SidebarProps {
    user: User;
}

const mainNavItems = [
    { href: '/inbox', icon: MessageSquare, label: 'Chat', exact: false },
    { href: '/crm', icon: Users, label: 'CRM', exact: false },
    { href: '/campaigns', icon: Send, label: 'Campanhas', exact: false },
    { href: '/analytics', icon: BarChart2, label: 'Analytics', exact: false },
    { href: '/integrations', icon: Puzzle, label: 'Integrações', exact: false },
    { href: '/support', icon: HelpCircle, label: 'Suporte', exact: false },
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
            className="h-6 w-6 text-blue-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]"
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
            className="focus:bg-red-500/10 focus:text-red-400 cursor-pointer text-red-400/80 hover:text-red-400 transition-colors"
        >
            <LogOut className="mr-2 h-4 w-4" />
            <span>{isPending ? 'Saindo...' : 'Sair'}</span>
        </DropdownMenuItem>
    );
}

// Reusable Sidebar Item
interface SidebarItemProps {
    href?: string;
    icon: LucideIcon;
    label: string;
    isActive?: boolean;
    onClick?: () => void;
    isButton?: boolean;
}

const SidebarItem = ({ href, icon: Icon, label, isActive, onClick, isButton }: SidebarItemProps) => {
    const Component = isButton ? 'button' : Link;
    const props = isButton ? { onClick } : { href: href || '#' };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* @ts-ignore - dynamic component props */}
                <Component
                    {...props}
                    className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 group relative my-1",
                        isActive
                            ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)]"
                            : "text-zinc-500 hover:text-white hover:bg-white/10"
                    )}
                >
                    <Icon className={cn(
                        "h-5 w-5 transition-transform duration-300",
                        isActive ? "scale-100" : "group-hover:scale-110"
                    )} />
                </Component>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[#0f1117]/90 backdrop-blur border-white/10 text-white font-medium shadow-xl z-[200]">
                <p>{label}</p>
            </TooltipContent>
        </Tooltip>
    );
};


export function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();

    return (
        <aside className="flex h-full w-[72px] flex-col items-center bg-[#0f1117]/60 backdrop-blur-xl border-r border-white/10 py-4 z-50 relative shadow-2xl">
            {/* Top Section */}
            <div className="flex flex-col items-center gap-6 flex-shrink-0">
                <Link href="/inbox" className="group flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/10 hover:from-blue-500/20 hover:to-blue-600/20 text-blue-500 ring-1 ring-blue-500/20 transition-all duration-300 mb-2 shadow-[0_0_15px_-3px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_-3px_rgba(59,130,246,0.5)]">
                    <DialogyLogo />
                </Link>
                <div className="h-px w-8 bg-white/5" />
                <WorkspaceSwitcher user={user} />
            </div>

            {/* Middle Section (Navigation) */}
            <div className="flex flex-1 flex-col items-center justify-center w-full gap-2">
                <nav className="flex flex-col items-center gap-1 w-full px-2">
                    <TooltipProvider delayDuration={0}>
                        {mainNavItems.map((item) => {
                            const isActive = item.exact
                                ? pathname === item.href
                                : pathname.startsWith(item.href) && (item.href !== '/' || pathname === '/');

                            // Special case for root/inbox overlap
                            const isReallyActive = item.href === '/inbox' ? pathname.startsWith('/inbox') || pathname === '/' : isActive;

                            return (
                                <SidebarItem
                                    key={item.label}
                                    href={item.href}
                                    icon={item.icon}
                                    label={item.label}
                                    isActive={isReallyActive}
                                />
                            );
                        })}

                        <div className="h-px w-8 bg-white/5 my-2" />

                        {/* Team Dropdown */}
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            className={cn(
                                                "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 group relative my-1",
                                                pathname.startsWith('/team')
                                                    ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)]"
                                                    : "text-zinc-500 hover:text-white hover:bg-white/10"
                                            )}
                                        >
                                            <Users2 className="h-5 w-5" />
                                        </button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="bg-[#0f1117]/90 backdrop-blur border-white/10 text-white font-medium shadow-xl z-[200]">
                                    <p>Equipe</p>
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent side="right" sideOffset={10} className="bg-[#0f1117]/90 backdrop-blur-xl border-white/10 text-white w-60 shadow-2xl p-1 rounded-xl z-[200]">
                                <DropdownMenuLabel className="text-xs font-medium text-white/50 uppercase tracking-wider px-2 py-2">Gestão de Equipes</DropdownMenuLabel>
                                {teamNavItems.map(item => (
                                    <Link key={item.href} href={item.href}>
                                        <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                            <div className="h-8 w-8 rounded-md bg-white/5 flex items-center justify-center mr-3 border border-white/5">
                                                <item.icon className="h-4 w-4 text-blue-400" />
                                            </div>
                                            <span className="text-sm">{item.label}</span>
                                        </DropdownMenuItem>
                                    </Link>
                                ))}
                                {user.is_superadmin && (
                                    <>
                                        <DropdownMenuSeparator className="bg-white/10 my-1" />
                                        <Link href="/team/logs">
                                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                                <div className="h-8 w-8 rounded-md bg-white/5 flex items-center justify-center mr-3 border border-white/5">
                                                    <Monitor className="h-4 w-4 text-purple-400" />
                                                </div>
                                                <span className="text-sm">Logs do Sistema</span>
                                            </DropdownMenuItem>
                                        </Link>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Automation Dropdown */}
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            className={cn(
                                                "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 group relative my-1",
                                                pathname.startsWith('/automations') || pathname.startsWith('/autopilot')
                                                    ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)]"
                                                    : "text-zinc-500 hover:text-white hover:bg-white/10"
                                            )}
                                        >
                                            <Bot className="h-5 w-5" />
                                        </button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="bg-[#0f1117]/90 backdrop-blur border-white/10 text-white font-medium shadow-xl z-[200]">
                                    <p>Automações</p>
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent side="right" sideOffset={10} className="bg-[#0f1117]/90 backdrop-blur-xl border-white/10 text-white w-60 shadow-2xl p-1 rounded-xl z-[200]">
                                <DropdownMenuLabel className="text-xs font-medium text-white/50 uppercase tracking-wider px-2 py-2">Automações & IA</DropdownMenuLabel>
                                {automationNavItems.map(item => (
                                    <Link key={item.href} href={item.href}>
                                        <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                            <div className="h-8 w-8 rounded-md bg-white/5 flex items-center justify-center mr-3 border border-white/5">
                                                <item.icon className="h-4 w-4 text-purple-400" />
                                            </div>
                                            <span className="text-sm">{item.label}</span>
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
                    <TooltipProvider delayDuration={0}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <button className="relative group p-1 focus:outline-none">
                                        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full opacity-0 group-hover:opacity-50 blur-md transition-opacity duration-500" />
                                        <Avatar className="cursor-pointer h-9 w-9 border border-white/10 group-hover:border-white/30 transition-all relative">
                                            {user.avatar ? (
                                                <AvatarImage src={user.avatar} alt={user.name || 'User'} className="object-cover" />
                                            ) : null}
                                            <AvatarFallback className="bg-zinc-800 text-xs font-medium text-white">{user.name?.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                                        </Avatar>
                                    </button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="bg-[#0f1117]/90 backdrop-blur border-white/10 text-white font-medium shadow-xl z-[200]">
                                <p>{user.name || 'Sua Conta'}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <DropdownMenuContent side="right" sideOffset={10} className="bg-[#0f1117]/90 backdrop-blur-xl border-white/10 text-white w-64 mb-2 shadow-2xl p-1 rounded-xl z-[200]">
                        <div className="flex items-center gap-3 p-3 mb-1 bg-white/5 rounded-lg border border-white/5">
                            <Avatar className="h-10 w-10 border border-white/10">
                                {user.avatar ? (
                                    <AvatarImage src={user.avatar} className="object-cover" />
                                ) : null}
                                <AvatarFallback className="bg-zinc-800 text-white">{user.name?.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{user.name || 'Usuário'}</p>
                                <p className="text-xs text-white/50 truncate">{user.email}</p>
                            </div>
                        </div>

                        <DropdownMenuSeparator className="bg-white/10 my-1" />

                        <Link href="/settings/profile">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                <UserIcon className="mr-3 h-4 w-4 text-white/50" />
                                <span>Perfil</span>
                            </DropdownMenuItem>
                        </Link>
                        <Link href="/settings/billing">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                <CreditCard className="mr-3 h-4 w-4 text-white/50" />
                                <span>Cobrança</span>
                            </DropdownMenuItem>
                        </Link>
                        <Link href="/settings">
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white cursor-pointer rounded-lg p-2.5 my-0.5">
                                <Settings className="mr-3 h-4 w-4 text-white/50" />
                                <span>Configurações</span>
                            </DropdownMenuItem>
                        </Link>

                        <DropdownMenuSeparator className="bg-white/10 my-1" />

                        <SignOutMenuItem user={user} />
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
}
