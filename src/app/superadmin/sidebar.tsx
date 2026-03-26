'use client';

import Link from "next/link";
import { usePathname } from 'next/navigation';
import {
    Home,
    CreditCard,
    FileText,
    HardDrive,
    Activity,
    Users,
    Settings,
    LogOut,
    LayoutDashboard,
    Globe,
    Megaphone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const mainNavItems = [
    { href: '/superadmin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: '/superadmin/billing', label: 'Cobranças', icon: CreditCard, exact: false },
    { href: '/superadmin/plans', label: 'Planos', icon: FileText, exact: false },
    { href: '/superadmin/users', label: 'Usuários', icon: Users, exact: false },
    { href: '/superadmin/clusters', label: 'Clusters', icon: HardDrive, exact: false },
];

const configNavItems = [
    { href: '/superadmin/alerts', label: 'Comunicados globais', icon: Megaphone, exact: true },
    { href: '/superadmin/meta-webhooks', label: 'Webhooks Meta', icon: Activity, exact: false },
    { href: '/superadmin/billing/settings', label: 'Config. Faturamento', icon: Settings, exact: true },
    { href: '/superadmin/seo', label: 'SEO Manager', icon: Globe, exact: false },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="hidden border-r bg-card md:block h-screen sticky top-0">
            <div className="flex h-full flex-col">
                <div className="flex h-[60px] items-center border-b px-6">
                    <Link href="/superadmin" className="flex items-center gap-2 font-bold text-lg text-primary">
                        <Activity className="h-6 w-6" />
                        <span className="">Dialogy Admin</span>
                    </Link>
                </div>

                <div className="flex-1 overflow-auto py-6">
                    <nav className="grid items-start px-4 text-sm font-medium gap-1">
                        <div className="px-2 text-xs font-semibold text-muted-foreground mb-2 mt-2 uppercase tracking-wider">
                            Visão Geral
                        </div>
                        {mainNavItems.map(item => {
                            const isActive = item.exact
                                ? pathname === item.href
                                : pathname.startsWith(item.href);

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50",
                                        isActive && "text-primary bg-primary/10 hover:bg-primary/15 font-semibold"
                                    )}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                            )
                        })}

                        <div className="px-2 text-xs font-semibold text-muted-foreground mb-2 mt-6 uppercase tracking-wider">
                            Configuração
                        </div>
                        {configNavItems.map(item => {
                            const isActive = item.exact
                                ? pathname === item.href
                                : pathname.startsWith(item.href);

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50",
                                        isActive && "text-primary bg-primary/10 hover:bg-primary/15 font-semibold"
                                    )}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                            )
                        })}
                    </nav>
                </div>

                <div className="p-4 border-t">
                    <Button variant="outline" className="w-full justify-start gap-2" asChild>
                        <Link href="/inbox">
                            <LogOut className="w-4 h-4" />
                            Voltar ao App
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
