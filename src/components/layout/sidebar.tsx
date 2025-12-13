"use client";

import Link from "next/link";
import {
  BarChart2,
  Bot,
  CreditCard,
  Fingerprint,
  HelpCircle,
  LogOut,
  LucideIcon,
  MessageSquare,
  Monitor,
  Puzzle,
  Rocket,
  Settings,
  ShieldAlert,
  User as UserIcon,
  Users,
  Users2,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { cn } from "@/lib/utils";
import { signOut } from "@/actions/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const mainNavItems = [
  { href: "/inbox", icon: MessageSquare, label: "Chat", exact: false },
  { href: "/crm", icon: Users, label: "CRM", exact: false },
  { href: "/campaigns", icon: MessageSquare, label: "Campanhas", exact: false },
  { href: "/analytics", icon: BarChart2, label: "Analytics", exact: false },
  { href: "/integrations", icon: Puzzle, label: "Integrações", exact: false },
  { href: "/support", icon: HelpCircle, label: "Suporte", exact: false },
];

const teamNavItems = [
  { href: "/team/members", icon: Users2, label: "Membros" },
  { href: "/team", icon: ShieldAlert, label: "Equipes" },
  { href: "/team/permissions", icon: Fingerprint, label: "Papéis & Permissões" },
];

const automationNavItems = [
  { href: "/automations/robots", icon: Rocket, label: "Agentes do Sistema" },
  { href: "/autopilot", icon: Bot, label: "Agente de IA" },
];

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
  );
}

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
};

interface SidebarProps {
  user: User;
}

function SidebarTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#0f1117]/95 px-3 py-1.5 text-xs text-white/90 opacity-0 shadow-xl ring-1 ring-white/10 backdrop-blur transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-1">
      {label}
    </span>
  );
}

function SidebarIconLink({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}) {
  const Icon = item.icon;

  return (
    <div className="relative group w-full flex items-center justify-center">
      <Link
        href={item.href}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300 relative",
          isActive
            ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.35)]"
            : "text-zinc-400 hover:text-white hover:bg-white/10"
        )}
        aria-label={item.label}
      >
        <Icon className="h-5 w-5" />
        {isActive && (
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-full bg-blue-300/80" />
        )}
      </Link>
      <SidebarTooltip label={item.label} />
    </div>
  );
}

type FlyoutItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  description?: string;
};

function FlyoutMenu({
  label,
  icon: Icon,
  items,
  isActive,
  isOpen,
  onToggle,
  containerRef,
  highlight,
  onClose,
}: {
  label: string;
  icon: LucideIcon;
  items: FlyoutItem[];
  isActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  highlight?: boolean;
  onClose?: () => void;
}) {
  return (
    <div ref={containerRef} className="relative group w-full flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300 relative",
          isActive
            ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.35)]"
            : "text-zinc-400 hover:text-white hover:bg-white/10"
        )}
        aria-expanded={isOpen}
        aria-label={label}
      >
        <Icon className={cn("h-5 w-5", highlight && "text-purple-300")} />
        {isActive && (
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-full bg-blue-300/80" />
        )}
      </button>
      <SidebarTooltip label={label} />

      {isOpen && (
        <div className="absolute left-14 top-1/2 z-50 w-72 -translate-y-1/2 rounded-xl border border-white/10 bg-[#0f1117]/95 shadow-2xl backdrop-blur p-2 space-y-1">
          <div className="px-2 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
              {label}
            </p>
          </div>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5 transition-colors group"
              onClick={onClose}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/5 bg-white/5 text-blue-300">
                <item.icon className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{item.label}</p>
                {item.description ? (
                  <p className="text-[11px] text-white/50 truncate">{item.description}</p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu({
  user,
  isOpen,
  onToggle,
  containerRef,
  onSignOut,
  signingOut,
}: {
  user: User;
  isOpen: boolean;
  onToggle: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div ref={containerRef} className="relative group w-full flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className="relative p-0.5 rounded-full bg-gradient-to-br from-blue-500/30 via-purple-500/20 to-blue-500/30 hover:from-blue-500/50 hover:via-purple-500/30 hover:to-blue-500/50 transition-all duration-300"
        aria-expanded={isOpen}
        aria-label="Conta"
      >
        <div className="absolute inset-0 blur-xl opacity-20 bg-blue-500/40" />
        <Avatar className="relative h-10 w-10 border border-white/10 bg-zinc-900">
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
          <AvatarFallback className="bg-zinc-800 text-xs font-semibold text-white">
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
      </button>
      <SidebarTooltip label={user.name || "Sua conta"} />

      {isOpen && (
        <div className="absolute left-14 bottom-0 z-50 w-72 rounded-xl border border-white/10 bg-[#0f1117]/95 shadow-2xl backdrop-blur p-3 space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
            <Avatar className="h-10 w-10 border border-white/10">
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
              <AvatarFallback className="bg-zinc-800 text-white">
                {user.name?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{user.name || "Usuário"}</p>
              <p className="text-xs text-white/50 truncate">{user.email}</p>
            </div>
          </div>

          <div className="space-y-1">
            <AccountLink href="/settings/profile" icon={UserIcon} label="Perfil" />
            <AccountLink href="/settings/billing" icon={CreditCard} label="Cobrança" />
            <AccountLink href="/settings" icon={Settings} label="Configurações" />
            {user.is_superadmin ? (
              <AccountLink href="/team/logs" icon={Monitor} label="Logs do Sistema" />
            ) : null}
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-300 transition hover:border-red-500/40 hover:bg-red-500/10"
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      )}
    </div>
  );
}

function AccountLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/5 bg-white/5 text-white/80">
        <Icon className="h-4 w-4" />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<"team" | "automation" | "account" | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const teamRef = useRef<HTMLDivElement>(null);
  const automationRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!openMenu) return;
      const ref =
        openMenu === "team"
          ? teamRef.current
          : openMenu === "automation"
            ? automationRef.current
            : accountRef.current;
      if (ref && !ref.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openMenu]);

  const isActive = (item: NavItem) => {
    if (item.exact) {
      return pathname === item.href;
    }
    if (item.href === "/inbox") {
      return pathname === "/" || pathname.startsWith("/inbox");
    }
    return pathname.startsWith(item.href);
  };

  const teamActive = useMemo(
    () => pathname.startsWith("/team"),
    [pathname]
  );
  const automationActive = useMemo(
    () => pathname.startsWith("/automations") || pathname.startsWith("/autopilot"),
    [pathname]
  );

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (user.activeWorkspaceId) {
        try {
          await fetch("/api/users/online-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId: user.activeWorkspaceId, isOnline: false }),
          });
        } catch (error) {
          console.error("Error setting offline status:", error);
        }
      }
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <aside className="relative z-50 flex h-full w-[78px] flex-col items-center gap-6 border-r border-white/10 bg-[#0f1117]/70 px-2 py-4 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col items-center gap-4">
        <Link
          href="/inbox"
          className="group relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/10 text-blue-500 ring-1 ring-blue-500/20 transition-all duration-300 hover:from-blue-500/20 hover:to-blue-600/20 hover:shadow-[0_0_20px_-4px_rgba(59,130,246,0.45)]"
          aria-label="Inbox"
        >
          <DialogyLogo />
        </Link>
        <div className="h-px w-8 bg-white/10" />
        <WorkspaceSwitcher user={user} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full gap-2 overflow-visible">
        <nav className="flex flex-col items-center gap-2 w-full overflow-visible">
          {mainNavItems.map((item) => (
            <SidebarIconLink key={item.href} item={item} isActive={isActive(item)} />
          ))}

          <div className="h-px w-8 bg-white/10 my-1.5" />

          <FlyoutMenu
            label="Equipe"
            icon={Users2}
            items={teamNavItems}
            isActive={teamActive}
            isOpen={openMenu === "team"}
            onToggle={() => setOpenMenu(openMenu === "team" ? null : "team")}
            containerRef={teamRef}
            onClose={() => setOpenMenu(null)}
          />

          <FlyoutMenu
            label="Automações"
            icon={Bot}
            items={automationNavItems}
            isActive={automationActive}
            isOpen={openMenu === "automation"}
            onToggle={() => setOpenMenu(openMenu === "automation" ? null : "automation")}
            containerRef={automationRef}
            highlight
            onClose={() => setOpenMenu(null)}
          />
        </nav>
      </div>

      <div className="flex w-full flex-col items-center gap-3 pb-1">

        <AccountMenu
          user={user}
          isOpen={openMenu === "account"}
          onToggle={() => setOpenMenu(openMenu === "account" ? null : "account")}
          containerRef={accountRef}
          onSignOut={handleSignOut}
          signingOut={signingOut}
        />
      </div>
    </aside>
  );
}
