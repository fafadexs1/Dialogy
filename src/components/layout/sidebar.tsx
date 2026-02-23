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
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  User as UserIcon,
  Users,
  Users2,
  Menu
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { cn } from "@/lib/utils";
import { signOut } from "@/actions/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { useI18n } from "@/i18n/i18n-provider";
import { motion, AnimatePresence } from "framer-motion";

const mainNavItems: NavItem[] = [
  { href: "/inbox", icon: MessageSquare, labelKey: "nav.chat", exact: false },
  { href: "/crm", icon: Users, labelKey: "nav.crm", exact: false },
  { href: "/campaigns", icon: Send, labelKey: "nav.campaigns", exact: false },
  { href: "/analytics", icon: BarChart2, labelKey: "nav.analytics", exact: false },
  { href: "/integrations", icon: Puzzle, labelKey: "nav.integrations", exact: false },
  { href: "/support", icon: HelpCircle, labelKey: "nav.support", exact: false },
  { href: "/nexus", icon: Sparkles, labelKey: "nav.nexus", exact: false },
];

const teamNavItems: FlyoutItemConfig[] = [
  { href: "/team/members", icon: Users2, labelKey: "nav.teamMembers" },
  { href: "/team", icon: ShieldAlert, labelKey: "nav.teams" },
  { href: "/team/permissions", icon: Fingerprint, labelKey: "nav.teamPermissions" },
];

const automationNavItems: FlyoutItemConfig[] = [
  { href: "/automations/robots", icon: Rocket, labelKey: "nav.systemAgents" },
  { href: "/autopilot", icon: Bot, labelKey: "nav.aiAgent" },
];

import Image from "next/image";

function DialogyLogo() {
  return (
    <div className="relative h-6 w-6 2xl:h-8 2xl:w-8 overflow-hidden rounded-lg shadow-lg shadow-emerald-500/20">
      <Image
        src="/logo-new.jpg"
        alt="Logo"
        fill
        className="object-cover"
        sizes="(max-width: 1535px) 24px, 32px"
      />
    </div>
  );
}

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  exact?: boolean;
};

interface SidebarProps {
  user: User;
}

function SidebarTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-zinc-950/90 px-3 py-1.5 text-xs text-white opacity-0 shadow-xl border border-white/10 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-1 z-50">
      {label}
    </span>
  );
}

function SidebarIconLink({
  item,
  label,
  isActive,
}: {
  item: NavItem;
  label: string;
  isActive: boolean;
}) {
  const Icon = item.icon;

  return (
    <div className="relative group w-full flex items-center justify-center py-0.5">
      <Link
        href={item.href}
        prefetch={false}
        className={cn(
          "flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg transition-all duration-300 relative group overflow-hidden",
          isActive
            ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)] border border-emerald-500/20"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
        )}
        aria-label={label}
      >
        <Icon className={cn("h-4 w-4 2xl:h-5 2xl:w-5 transition-transform duration-300 group-hover:scale-110", isActive && "scale-105")} />

        {isActive && (
          <motion.div
            layoutId="active-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          />
        )}
      </Link>
      <SidebarTooltip label={label} />
    </div>
  );
}

type FlyoutItemConfig = {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  descriptionKey?: string;
};

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
    <div ref={containerRef} className="relative group w-full flex items-center justify-center py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg transition-all duration-300 relative group overflow-hidden",
          isActive
            ? "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)] border border-emerald-500/20"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
        )}
        aria-expanded={isOpen}
        aria-label={label}
      >
        <Icon className={cn("h-4 w-4 2xl:h-5 2xl:w-5 transition-transform duration-300 group-hover:scale-110", highlight && !isActive && "text-purple-400", isActive && "scale-105")} />
        {isActive && (
          <motion.div
            layoutId="active-indicator-flyout"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          />
        )}
      </button>
      <SidebarTooltip label={label} />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute left-14 top-1/2 z-50 w-72 -translate-y-1/2 rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-xl p-2 space-y-1"
          >
            <div className="px-3 py-2 border-b border-white/5 mb-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                {label}
              </p>
            </div>
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5 transition-colors group relative overflow-hidden"
                onClick={onClose}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 border border-white/5 text-zinc-400 group-hover:text-emerald-400 group-hover:border-emerald-500/30 transition-colors">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors truncate">{item.label}</p>
                  {item.description ? (
                    <p className="text-[11px] text-zinc-500 truncate">{item.description}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
  const { t } = useI18n();

  return (
    <div ref={containerRef} className="relative group w-full flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "relative p-0.5 rounded-full transition-all duration-300 ring-2 ring-transparent hover:ring-emerald-500/50",
          isOpen && "ring-emerald-500/50"
        )}
        aria-expanded={isOpen}
        aria-label={t("account.label")}
      >
        <Avatar className="h-8 w-8 2xl:h-9 2xl:w-9 border-2 border-zinc-800 bg-zinc-900">
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
          <AvatarFallback className="bg-zinc-800 text-xs font-semibold text-zinc-400">
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 border-[1.5px] border-zinc-950" />
      </button>
      <SidebarTooltip label={user.name || t("account.yourAccount")} />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute left-14 bottom-2 z-50 w-72 rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-xl p-3 space-y-2 overflow-hidden"
          >
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-emerald-500/10 to-transparent pointer-events-none" />

            <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-3 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-50" />
              <Avatar className="h-10 w-10 border border-white/10 relative z-10">
                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
                <AvatarFallback className="bg-zinc-800 text-zinc-400">
                  {user.name?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 relative z-10">
                <p className="text-sm font-semibold text-white truncate">
                  {user.name || t("account.userFallback")}
                </p>
                <p className="text-xs text-zinc-400 truncate">{user.email}</p>
              </div>
            </div>

            <div className="space-y-1 relative z-10">
              <AccountLink href="/settings/profile" icon={UserIcon} label={t("account.profile")} />
              <AccountLink href="/settings/billing" icon={CreditCard} label={t("account.billing")} />
              <AccountLink href="/settings" icon={Settings} label={t("account.settings")} />
              {user.is_superadmin ? (
                <AccountLink href="/team/logs" icon={Monitor} label={t("account.systemLogs")} />
              ) : null}
            </div>

            <div className="pt-2 border-t border-white/5 relative z-10">
              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200 group"
                disabled={signingOut}
              >
                <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                {signingOut ? t("account.signingOut") : t("account.signOut")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
      prefetch={false}
      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white group"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-500 group-hover:text-emerald-400 group-hover:border-emerald-500/20 transition-colors">
        <Icon className="h-4 w-4" />
      </span>
      <span>{label}</span>
      <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
    </Link>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<"team" | "automation" | "account" | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const teamRef = useRef<HTMLDivElement>(null);
  const automationRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const filteredNavItems = mainNavItems;

  const teamItems = useMemo(
    () =>
      teamNavItems.map((item) => ({
        href: item.href,
        icon: item.icon,
        label: t(item.labelKey),
        description: item.descriptionKey ? t(item.descriptionKey) : undefined,
      })),
    [t]
  );

  const automationItems = useMemo(
    () =>
      automationNavItems.map((item) => ({
        href: item.href,
        icon: item.icon,
        label: t(item.labelKey),
        description: item.descriptionKey ? t(item.descriptionKey) : undefined,
      })),
    [t]
  );

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
            body: JSON.stringify({ workspaceId: user.activeWorkspaceId, isOnline: false, forceOffline: true }),
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
    <aside className="relative z-50 flex h-full w-[64px] 2xl:w-[78px] flex-col items-center gap-4 border-r border-white/5 bg-black backdrop-blur-xl px-2 py-4 shadow-2xl">
      <div className="flex flex-col items-center gap-4 w-full">
        <Link
          href="/inbox"
          prefetch={false}
          className="group relative flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10 transition-all duration-300 hover:bg-emerald-500/10 hover:ring-emerald-500/30 hover:shadow-[0_0_20px_-4px_rgba(16,185,129,0.2)]"
          aria-label={t("nav.chat")}
        >
          <DialogyLogo />
        </Link>
        <div className="h-px w-6 bg-white/5" />
        <WorkspaceSwitcher user={user} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full gap-1 overflow-visible">
        <nav className="flex flex-col items-center gap-1 w-full overflow-visible">
          {filteredNavItems.map((item) => (
            <SidebarIconLink
              key={item.href}
              item={item}
              label={t(item.labelKey)}
              isActive={isActive(item)}
            />
          ))}

          <div className="h-px w-6 bg-white/5 my-2" />

          <FlyoutMenu
            label={t("nav.team")}
            icon={Users2}
            items={teamItems}
            isActive={teamActive}
            isOpen={openMenu === "team"}
            onToggle={() => setOpenMenu(openMenu === "team" ? null : "team")}
            containerRef={teamRef}
            onClose={() => setOpenMenu(null)}
          />

          <FlyoutMenu
            label={t("nav.automations")}
            icon={Bot}
            items={automationItems}
            isActive={automationActive}
            isOpen={openMenu === "automation"}
            onToggle={() => setOpenMenu(openMenu === "automation" ? null : "automation")}
            containerRef={automationRef}
            highlight
            onClose={() => setOpenMenu(null)}
          />
        </nav>
      </div>

      <div className="flex w-full flex-col items-center gap-4 pb-2">
        <div className="relative group w-full flex items-center justify-center">
          <LanguageToggle />
          <SidebarTooltip label={t("language.label")} />
        </div>
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
