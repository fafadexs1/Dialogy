
'use client';

import Link from "next/link";
import { usePathname } from 'next/navigation';
import { Bell, Home, LineChart, Package, Package2, ShoppingCart, Users, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const navItems = [
    { href: '/superadmin/billing', label: 'Cobranças', icon: CreditCard },
    { href: '/superadmin/users', label: 'Usuários', icon: Users },
]

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="hidden border-r bg-muted/40 md:block">
            <div className="flex h-full max-h-screen flex-col gap-2">
                <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
                    <Link href="/superadmin" className="flex items-center gap-2 font-semibold">
                        <Package2 className="h-6 w-6" />
                        <span className="">Super Admin</span>
                    </Link>
                </div>
                <div className="flex-1">
                    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
                        {navItems.map(item => {
                             const isActive = pathname.startsWith(item.href);
                             return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                                        isActive && "text-primary bg-muted"
                                    )}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                             )
                        })}
                    </nav>
                </div>
                <div className="mt-auto p-4">
                    <Button size="sm" className="w-full" asChild>
                         <Link href="/">Voltar ao App</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}

    