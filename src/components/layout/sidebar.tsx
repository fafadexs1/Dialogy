"use client";

import Link from "next/link";
import {
  BarChart2,
  Bot,
  CreditCard,
  Fingerprint,
  Gift,
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
import { useTheme } from "@/providers/theme-provider";
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
  { href: "/referrals", icon: Gift, labelKey: "nav.referrals", exact: false, attention: true },
  { href: "/integrations", icon: Puzzle, labelKey: "nav.integrations", exact: false },
  { href: "/support", icon: HelpCircle, labelKey: "nav.support", exact: false },
  { href: "/nexus", icon: Sparkles, labelKey: "nav.nexus", exact: false },
];

const crmNavItems: FlyoutItemConfig[] = [
  { href: "/crm", icon: Users, labelKey: "nav.crm" },
  { href: "/campaigns", icon: Send, labelKey: "nav.campaigns" },
  { href: "/analytics", icon: BarChart2, labelKey: "nav.analytics" },
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
        priority
      />
    </div>
  );
}

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  exact?: boolean;
  attention?: boolean;
};

interface SidebarProps {
  user: User;
}

function SidebarTooltip({ label, light = false }: { label: string; light?: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-14 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs opacity-0 shadow-xl backdrop-blur-md transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100",
        light
          ? "border border-slate-200/80 bg-white/95 text-slate-700"
          : "border border-white/10 bg-zinc-950/90 text-white"
      )}
    >
      {label}
    </span>
  );
}

function SidebarIconLink({
  item,
  label,
  isActive,
  light = false,
}: {
  item: NavItem;
  label: string;
  isActive: boolean;
  light?: boolean;
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
            ? light
              ? "border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-[0_10px_24px_-18px_rgba(16,185,129,0.75)]"
              : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)] border border-emerald-500/20"
            : light
              ? "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
        )}
        aria-label={label}
      >
        <motion.span
          animate={
            item.attention && !isActive
              ? { y: [0, -4, 0], rotate: [0, -8, 8, 0] }
              : { y: 0, rotate: 0 }
          }
          transition={
            item.attention && !isActive
              ? { duration: 1.8, repeat: Infinity, repeatDelay: 1.1, ease: "easeInOut" }
              : { duration: 0.2 }
          }
          className="relative flex items-center justify-center"
        >
          <Icon className={cn("h-4 w-4 2xl:h-5 2xl:w-5 transition-transform duration-300 group-hover:scale-110", isActive && "scale-105")} />
        </motion.span>

        {item.attention && !isActive ? (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" />
        ) : null}

        {isActive && (
          <motion.div
            layoutId="active-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          />
        )}
      </Link>
      <SidebarTooltip label={label} light={light} />
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
  light = false,
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
  light?: boolean;
}) {
  return (
    <div ref={containerRef} className="relative group w-full flex items-center justify-center py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg transition-all duration-300 relative group overflow-hidden",
          isActive
            ? light
              ? "border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-[0_10px_24px_-18px_rgba(16,185,129,0.75)]"
              : "bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-emerald-400 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)] border border-emerald-500/20"
            : light
              ? "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
      <SidebarTooltip label={label} light={light} />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "absolute left-14 top-1/2 z-50 w-72 -translate-y-1/2 rounded-2xl p-2 shadow-2xl backdrop-blur-xl",
              light
                ? "border border-slate-200/80 bg-white/95"
                : "border border-white/10 bg-zinc-950/90"
            )}
          >
            <div className={cn("mb-1 px-3 py-2 border-b", light ? "border-slate-200/80" : "border-white/5")}>
              <p className={cn("text-[11px] font-bold uppercase tracking-wider", light ? "text-slate-500" : "text-zinc-500")}>
                {label}
              </p>
            </div>
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={cn(
                  "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 transition-colors",
                  light ? "hover:bg-slate-50" : "hover:bg-white/5"
                )}
                onClick={onClose}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
                    light
                      ? "border-slate-200 bg-slate-50 text-slate-500 group-hover:border-emerald-200 group-hover:text-emerald-600"
                      : "border-white/5 bg-zinc-900 text-zinc-400 group-hover:border-emerald-500/30 group-hover:text-emerald-400"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={cn("truncate text-sm font-medium transition-colors", light ? "text-slate-800 group-hover:text-slate-950" : "text-zinc-200 group-hover:text-white")}>{item.label}</p>
                  {item.description ? (
                    <p className={cn("truncate text-[11px]", light ? "text-slate-500" : "text-zinc-500")}>{item.description}</p>
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
  light = false,
}: {
  user: User;
  isOpen: boolean;
  onToggle: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSignOut: () => void;
  signingOut: boolean;
  light?: boolean;
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
        <Avatar className={cn("h-8 w-8 2xl:h-9 2xl:w-9 border-2", light ? "border-slate-200 bg-slate-100" : "border-zinc-800 bg-zinc-900")}>
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
          <AvatarFallback className={cn("text-xs font-semibold", light ? "bg-slate-200 text-slate-600" : "bg-zinc-800 text-zinc-400")}>
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
      </button>
      <SidebarTooltip label={user.name || t("account.yourAccount")} light={light} />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "absolute left-14 bottom-2 z-50 w-72 overflow-hidden rounded-2xl p-3 shadow-2xl backdrop-blur-xl",
              light
                ? "border border-slate-200/80 bg-white/95"
                : "border border-white/10 bg-zinc-950/90"
            )}
          >
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-emerald-500/10 to-transparent pointer-events-none" />

            <div className={cn("relative flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-3", light ? "border-slate-200/80 bg-slate-50" : "border-white/5 bg-white/5")}>
              <div className={cn("absolute inset-0 opacity-50", light ? "bg-gradient-to-br from-white to-slate-50" : "bg-gradient-to-br from-white/5 to-transparent")} />
              <Avatar className={cn("relative z-10 h-10 w-10 border", light ? "border-slate-200" : "border-white/10")}>
                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
                <AvatarFallback className={cn(light ? "bg-slate-200 text-slate-600" : "bg-zinc-800 text-zinc-400")}>
                  {user.name?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 relative z-10">
                <p className={cn("truncate text-sm font-semibold", light ? "text-slate-900" : "text-white")}>
                  {user.name || t("account.userFallback")}
                </p>
                <p className={cn("truncate text-xs", light ? "text-slate-500" : "text-zinc-400")}>{user.email}</p>
              </div>
            </div>

            <div className="space-y-1 relative z-10">
              <AccountLink href="/settings/profile" icon={UserIcon} label={t("account.profile")} light={light} />
              <AccountLink href="/settings/billing" icon={CreditCard} label={t("account.billing")} light={light} />
              <AccountLink href="/settings" icon={Settings} label={t("account.settings")} light={light} />
              {user.is_superadmin ? (
                <AccountLink href="/team/logs" icon={Monitor} label={t("account.systemLogs")} light={light} />
              ) : null}
            </div>

            <div className={cn("relative z-10 pt-2 border-t", light ? "border-slate-200/80" : "border-white/5")}>
              <button
                type="button"
                onClick={onSignOut}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition",
                  light
                    ? "border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
                    : "border-rose-500/20 bg-rose-500/5 text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200"
                )}
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
  light = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  light?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
        light
          ? "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          : "text-zinc-400 hover:bg-white/5 hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          light
            ? "border-slate-200 bg-slate-50 text-slate-500 group-hover:border-emerald-200 group-hover:text-emerald-600"
            : "border-white/5 bg-white/5 text-zinc-500 group-hover:border-emerald-500/20 group-hover:text-emerald-400"
        )}
      >
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
  const { resolvedTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<"crm" | "team" | "automation" | "account" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [mounted, setMounted] = useState(false);
  const initialTheme = user.themePreference === "light" || user.themePreference === "dark"
    ? user.themePreference
    : "dark";
  const isLightSidebar = (mounted ? resolvedTheme ?? initialTheme : initialTheme) === "light";

  const crmRef = useRef<HTMLDivElement>(null);
  const teamRef = useRef<HTMLDivElement>(null);
  const automationRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const filteredNavItems = mainNavItems;

  useEffect(() => {
    setMounted(true);
  }, []);

  const crmItems = useMemo(
    () =>
      crmNavItems.map((item) => ({
        href: item.href,
        icon: item.icon,
        label: t(item.labelKey),
        description: item.descriptionKey ? t(item.descriptionKey) : undefined,
      })),
    [t]
  );

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
        openMenu === "crm"
          ? crmRef.current
          : openMenu === "team"
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
  const crmActive = useMemo(
    () => pathname.startsWith("/crm") || pathname.startsWith("/campaigns") || pathname.startsWith("/analytics"),
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
            body: JSON.stringify({ workspaceId: user.activeWorkspaceId, isOnline: false, forceOffline: true, source: 'logout' }),
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
    <aside
      className={cn(
        "relative z-50 flex h-full w-[64px] 2xl:w-[78px] flex-col items-center gap-4 px-2 py-4 backdrop-blur-xl",
        isLightSidebar
          ? "border-r border-slate-200/80 bg-white/95 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.18)]"
          : "border-r border-white/10 bg-[#050507]/95 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.85)]"
      )}
    >
      <div className="flex flex-col items-center gap-4 w-full">
        <Link
          href="/inbox"
          prefetch={false}
          className={cn(
            "group relative flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg transition-all duration-300",
            isLightSidebar
              ? "bg-slate-50 ring-1 ring-slate-200 hover:bg-emerald-50 hover:ring-emerald-200 hover:shadow-[0_12px_24px_-18px_rgba(16,185,129,0.6)]"
              : "bg-white/5 ring-1 ring-white/10 hover:bg-emerald-500/10 hover:ring-emerald-500/30 hover:shadow-[0_12px_24px_-18px_rgba(16,185,129,0.45)]"
          )}
          aria-label={t("nav.chat")}
        >
          <DialogyLogo />
        </Link>
        <div className={cn("h-px w-6", isLightSidebar ? "bg-slate-200/90" : "bg-white/10")} />
        <WorkspaceSwitcher user={user} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full gap-1 overflow-visible">
        <nav className="flex flex-col items-center gap-1 w-full overflow-visible">
          {filteredNavItems.slice(0, 1).map((item) => (
            <SidebarIconLink
              key={item.href}
              item={item}
              label={t(item.labelKey)}
              isActive={isActive(item)}
              light={isLightSidebar}
            />
          ))}

          <FlyoutMenu
            label={t("nav.crm")}
            icon={Users}
            items={crmItems}
            isActive={crmActive}
            isOpen={openMenu === "crm"}
            onToggle={() => setOpenMenu(openMenu === "crm" ? null : "crm")}
            containerRef={crmRef}
            onClose={() => setOpenMenu(null)}
            light={isLightSidebar}
          />

          {filteredNavItems.slice(1).map((item) => (
            <SidebarIconLink
              key={item.href}
              item={item}
              label={t(item.labelKey)}
              isActive={isActive(item)}
              light={isLightSidebar}
            />
          ))}

          <div className={cn("my-2 h-px w-6", isLightSidebar ? "bg-slate-200/90" : "bg-white/10")} />

          <FlyoutMenu
            label={t("nav.team")}
            icon={Users2}
            items={teamItems}
            isActive={teamActive}
            isOpen={openMenu === "team"}
            onToggle={() => setOpenMenu(openMenu === "team" ? null : "team")}
            containerRef={teamRef}
            onClose={() => setOpenMenu(null)}
            light={isLightSidebar}
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
            light={isLightSidebar}
          />
        </nav>
      </div>

      <div className="flex w-full flex-col items-center gap-4 pb-2">
        <div className="relative group w-full flex items-center justify-center">
          <LanguageToggle />
          <SidebarTooltip label={t("language.label")} light={isLightSidebar} />
        </div>
        <AccountMenu
          user={user}
          isOpen={openMenu === "account"}
          onToggle={() => setOpenMenu(openMenu === "account" ? null : "account")}
          containerRef={accountRef}
          onSignOut={handleSignOut}
          signingOut={signingOut}
          light={isLightSidebar}
        />
      </div>
    </aside>
  );
}
