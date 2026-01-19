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
    <div className="relative h-6 w-6 2xl:h-8 2xl:w-8 overflow-hidden rounded-md">
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
    <span className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-sidebar px-3 py-1.5 text-xs text-sidebar-foreground opacity-0 shadow-xl ring-1 ring-sidebar-border backdrop-blur transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-1">
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
    <div className="relative group w-full flex items-center justify-center">
      <Link
        href={item.href}
        prefetch={false}
        className={cn(
          "flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg 2xl:rounded-xl transition-all duration-300 relative",
          isActive
            ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.35)]"
            : "text-zinc-400 hover:text-white hover:bg-white/10"
        )}
        aria-label={label}
      >
        <Icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
        {isActive && (
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-full bg-blue-300/80" />
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
    <div ref={containerRef} className="relative group w-full flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg 2xl:rounded-xl transition-all duration-300 relative",
          isActive
            ? "bg-blue-600 text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.35)]"
            : "text-zinc-400 hover:text-white hover:bg-white/10"
        )}
        aria-expanded={isOpen}
        aria-label={label}
      >
        <Icon className={cn("h-4 w-4 2xl:h-5 2xl:w-5", highlight && "text-purple-300")} />
        {isActive && (
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-full bg-blue-300/80" />
        )}
      </button>
      <SidebarTooltip label={label} />

      {isOpen && (
        <div className="absolute left-14 top-1/2 z-50 w-72 -translate-y-1/2 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl p-2 space-y-1">
          <div className="px-2 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </p>
          </div>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-sidebar-accent transition-colors group"
              onClick={onClose}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-primary">
                <item.icon className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{item.label}</p>
                {item.description ? (
                  <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
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
  const { t } = useI18n();

  return (
    <div ref={containerRef} className="relative group w-full flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        className="relative p-0.5 rounded-full bg-gradient-to-br from-blue-500/30 via-purple-500/20 to-blue-500/30 hover:from-blue-500/50 hover:via-purple-500/30 hover:to-blue-500/50 transition-all duration-300"
        aria-expanded={isOpen}
        aria-label={t("account.label")}
      >
        <div className="absolute inset-0 blur-xl opacity-20 bg-primary/40" />
        <Avatar className="relative h-8 w-8 2xl:h-10 2xl:w-10 border border-sidebar-border bg-sidebar-accent">
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
          <AvatarFallback className="bg-muted text-xs font-semibold text-sidebar-foreground">
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
      </button>
      <SidebarTooltip label={user.name || t("account.yourAccount")} />

      {isOpen && (
        <div className="absolute left-14 bottom-0 z-50 w-72 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl p-3 space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5">
            <Avatar className="h-10 w-10 border border-sidebar-border">
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
              <AvatarFallback className="bg-muted text-sidebar-foreground">
                {user.name?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">
                {user.name || t("account.userFallback")}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>

          <div className="space-y-1">
            <AccountLink href="/settings/profile" icon={UserIcon} label={t("account.profile")} />
            <AccountLink href="/settings/billing" icon={CreditCard} label={t("account.billing")} />
            <AccountLink href="/settings" icon={Settings} label={t("account.settings")} />
            {user.is_superadmin ? (
              <AccountLink href="/team/logs" icon={Monitor} label={t("account.systemLogs")} />
            ) : null}
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-300 transition hover:border-red-500/40 hover:bg-red-500/10"
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? t("account.signingOut") : t("account.signOut")}
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
      prefetch={false}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80">
        <Icon className="h-4 w-4" />
      </span>
      <span>{label}</span>
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

  // Filter Nav Items based on configuration
  const activeWorkspace = user.workspaces?.find(w => w.id === user.activeWorkspaceId);
  const hasNexusConfig = !!activeWorkspace?.nexus_settings?.email;

  const filteredNavItems = mainNavItems.filter(item => {
    if (item.href === '/nexus' && !hasNexusConfig) return false;
    return true;
  });

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
    <aside className="relative z-50 flex h-full w-[64px] 2xl:w-[78px] flex-col items-center gap-4 2xl:gap-6 border-r border-sidebar-border bg-sidebar dark:bg-black px-1.5 2xl:px-2 py-3 2xl:py-4 shadow-2xl">
      <div className="flex flex-col items-center gap-3 2xl:gap-4">
        <Link
          href="/inbox"
          prefetch={false}
          className="group relative flex h-9 w-9 2xl:h-11 2xl:w-11 items-center justify-center rounded-lg 2xl:rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 transition-all duration-300 hover:bg-primary/20 hover:shadow-[0_0_20px_-4px_rgba(var(--primary),0.45)]"
          aria-label={t("nav.chat")}
        >
          <DialogyLogo />
        </Link>
        <div className="h-px w-8 bg-sidebar-border" />
        <WorkspaceSwitcher user={user} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full gap-2 overflow-visible">
        <nav className="flex flex-col items-center gap-2 w-full overflow-visible">
          {filteredNavItems.map((item) => (
            <SidebarIconLink
              key={item.href}
              item={item}
              label={t(item.labelKey)}
              isActive={isActive(item)}
            />
          ))}

          <div className="h-px w-8 bg-sidebar-border my-1.5" />

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

      <div className="flex w-full flex-col items-center gap-3 pb-1">
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
