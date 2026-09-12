"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart2,
  Bot,
  BrainCircuit,
  Cable,
  ChevronRight,
  CircleHelp,
  ContactRound,
  CreditCard,
  Fingerprint,
  Flame,
  Gift,
  Inbox,
  LayoutGrid,
  LogOut,
  LucideIcon,
  MessageCircleMore,
  MessageSquareMore,
  ScrollText,
  Send,
  Settings2,
  Sparkles,
  Store,
  UserRound,
  Users,
  UsersRound,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { signOut } from "@/actions/auth";
import { getHasUnreadProductUpdatesAction } from "@/actions/product-updates";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { useI18n } from "@/i18n/i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_UPDATES_REALTIME_TOPIC } from "@/lib/product-updates";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTheme } from "@/providers/theme-provider";

import { WorkspaceSwitcher } from "./workspace-switcher";

type MenuId = "clients" | "automation" | "integrations" | "team" | "account";

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  descriptionKey?: string;
  exact?: boolean;
};

type FlyoutItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  exact?: boolean;
};

// 1. Inbox (Principal ferramenta de atendimento)
const inboxNavItem: NavItem = {
  href: "/inbox",
  icon: Inbox,
  labelKey: "nav.inbox",
};

// 2. Clientes & Vendas
const clientsNavItems: NavItem[] = [
  {
    href: "/crm",
    icon: ContactRound,
    labelKey: "nav.crm",
    descriptionKey: "nav.crmDescription",
  },
  {
    href: "/campaigns",
    icon: Send,
    labelKey: "nav.campaigns",
    descriptionKey: "nav.campaignsDescription",
  },
  {
    href: "/analytics",
    icon: BarChart2,
    labelKey: "nav.analytics",
    descriptionKey: "nav.analyticsDescription",
  },
];

// 3. Automação & Inteligência
const automationNavItems: NavItem[] = [
  {
    href: "/nexus",
    icon: Sparkles,
    labelKey: "nav.nexus",
    descriptionKey: "nav.nexusDescription",
  },
  {
    href: "/autopilot",
    icon: BrainCircuit,
    labelKey: "nav.aiAgents",
    descriptionKey: "nav.autopilotDescription",
  },
  {
    href: "/automations/robots",
    icon: Bot,
    labelKey: "nav.systemAgents",
    descriptionKey: "nav.systemAgentsDescription",
  },
];

// 4. Integrações (Reformulado: estrutura limpa em coluna única, sem poluição de 3 colunas)
const integrationsCatalogItem: NavItem = {
  href: "/integrations",
  icon: LayoutGrid,
  labelKey: "nav.integrationsCatalog",
  descriptionKey: "nav.integrationsCatalogDescription",
  exact: true,
};

const integrationsKeyHubs: NavItem[] = [
  {
    href: "/integrations/evolution-api",
    icon: MessageCircleMore,
    labelKey: "nav.whatsapp",
    descriptionKey: "nav.channelsDescription",
  },
  {
    href: "/integrations/mcp",
    icon: Webhook,
    labelKey: "nav.mcp",
    descriptionKey: "nav.mcpDescription",
  },
  {
    href: "/integrations/mercadolivre",
    icon: Store,
    labelKey: "nav.mercadoLivre",
    descriptionKey: "nav.businessOperationsDescription",
  },
];

// 5. Equipe & Acesso (Logs apenas para superadmin)
const baseTeamNavItems: NavItem[] = [
  {
    href: "/team/members",
    icon: UsersRound,
    labelKey: "nav.teamMembers",
    descriptionKey: "nav.teamMembersDescription",
  },
  {
    href: "/team",
    icon: Users,
    labelKey: "nav.teams",
    descriptionKey: "nav.teamsDescription",
    exact: true,
  },
  {
    href: "/team/permissions",
    icon: Fingerprint,
    labelKey: "nav.teamPermissions",
    descriptionKey: "nav.teamPermissionsDescription",
  },
];

// 6. Comunidade & Social (Elevada diretamente ao menu principal de primeiro nível)
const communityNavItem: NavItem = {
  href: "/comunidade",
  icon: Flame,
  labelKey: "nav.community",
};

// 7. Rodapé & Suporte (O ícone repetido 'settings' foi retirado da barra e consolidado no menu da conta)
const helpNavItem: NavItem = {
  href: "/support",
  icon: CircleHelp,
  labelKey: "nav.help",
};

const NAV_BUTTON_CLASS =
  "relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-slate-400/50 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9";

function translateItem(item: NavItem, t: (key: string) => string): FlyoutItem {
  return {
    href: item.href,
    icon: item.icon,
    label: t(item.labelKey),
    description: item.descriptionKey ? t(item.descriptionKey) : undefined,
    exact: item.exact,
  };
}

function routeIsActive(pathname: string, href: string, exact = false) {
  if (href === "/inbox") {
    return pathname === "/" || pathname === "/inbox" || pathname.startsWith("/inbox/");
  }

  if (exact) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function getEnabledMenuItems(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'
    )
  );
}

function focusFirstMenuItem(containerRef: React.RefObject<HTMLDivElement | null>) {
  window.requestAnimationFrame(() => {
    const menu = containerRef.current?.querySelector<HTMLElement>('[role="menu"]');
    if (menu) getEnabledMenuItems(menu)[0]?.focus();
  });
}

function restoreMenuTriggerFocus(containerRef: React.RefObject<HTMLDivElement | null>) {
  window.requestAnimationFrame(() => {
    containerRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus();
  });
}

function handleMenuKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  onClose: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const items = getEnabledMenuItems(event.currentTarget);
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  let nextIndex: number | null = null;

  if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;

  if (nextIndex !== null && items.length > 0) {
    event.preventDefault();
    items[nextIndex]?.focus();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    restoreMenuTriggerFocus(containerRef);
  }
}

function DialogyLogo() {
  return (
    <div className="relative h-7 w-7 overflow-hidden rounded-lg">
      <Image
        src="/logo-new.jpg"
        alt="Dialogy"
        fill
        className="object-cover"
        sizes="28px"
        priority
      />
    </div>
  );
}

// Tooltip aprimorado: SEM focus-within para não ficar travado aberto após o clique
function SidebarTooltip({
  label,
  subtitle,
  light,
  visible = true,
}: {
  label: string;
  subtitle?: string;
  light: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[110] -translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 shadow-lg transition-all duration-150 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
        light
          ? "border border-slate-200 bg-slate-900 text-white"
          : "border border-white/10 bg-zinc-900 text-zinc-100"
      )}
    >
      <p className="text-xs font-semibold leading-tight">{label}</p>
      {subtitle ? (
        <p className={cn("mt-0.5 text-[10px] leading-tight", light ? "text-slate-300" : "text-zinc-400")}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function navButtonClass({
  active,
  open = false,
  light,
}: {
  active: boolean;
  open?: boolean;
  light: boolean;
}) {
  if (active) {
    return cn(
      NAV_BUTTON_CLASS,
      light
        ? "bg-slate-900 text-white shadow-sm"
        : "bg-white/[0.14] text-white border border-white/15 shadow-sm"
    );
  }

  if (open) {
    return cn(
      NAV_BUTTON_CLASS,
      light
        ? "bg-slate-100 text-slate-900 border border-slate-300/80"
        : "bg-white/[0.08] text-white border border-white/10"
    );
  }

  return cn(
    NAV_BUTTON_CLASS,
    light
      ? "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
  );
}

function ActiveRail({ light }: { light: boolean }) {
  return (
    <motion.span
      layoutId="sidebar-active-rail"
      className={cn(
        "absolute -left-[8px] top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full",
        light ? "bg-slate-900" : "bg-blue-500"
      )}
      transition={{ type: "spring", stiffness: 450, damping: 35 }}
    />
  );
}

function SidebarIconLink({
  item,
  label,
  subtitle,
  active,
  light,
  suppressTooltip = false,
  badgeRed = false,
}: {
  item: NavItem;
  label: string;
  subtitle?: string;
  active: boolean;
  light: boolean;
  suppressTooltip?: boolean;
  badgeRed?: boolean;
}) {
  const Icon = item.icon;

  return (
    <div className="group relative flex w-full items-center justify-center">
      <Link
        href={item.href}
        prefetch={false}
        className={cn(
          navButtonClass({ active, light }),
          badgeRed && !active && (
            light
              ? "text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 border border-red-200 shadow-sm shadow-red-500/10"
              : "text-red-400 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300 border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.25)]"
          )
        )}
        aria-label={label}
        aria-current={active ? "page" : undefined}
      >
        {active ? <ActiveRail light={light} /> : null}
        <Icon className={cn(
          "h-[18px] w-[18px] stroke-[1.8] transition-all duration-200 2xl:h-5 2xl:w-5 group-hover:scale-110",
          badgeRed && !active && "text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]"
        )} aria-hidden="true" />

        {badgeRed && !active ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 ring-2 ring-white dark:ring-[#0c0e12] shadow-[0_0_8px_rgba(239,68,68,0.9)]"></span>
          </span>
        ) : null}
      </Link>
      <SidebarTooltip
        label={label}
        subtitle={badgeRed && !active ? "Nova atualização disponível!" : subtitle}
        light={light}
        visible={!suppressTooltip}
      />
    </div>
  );
}

function FlyoutItemLink({
  item,
  pathname,
  light,
  dense = false,
  featured = false,
  onClose,
}: {
  item: FlyoutItem;
  pathname: string;
  light: boolean;
  dense?: boolean;
  featured?: boolean;
  onClose: () => void;
}) {
  const active = routeIsActive(pathname, item.href, item.exact);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onClose}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/item flex min-w-0 items-center rounded-xl border border-transparent outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue-500/50",
        dense ? "gap-2.5 px-2.5 py-2" : "gap-3 px-3 py-2.5",
        featured && "px-3.5 py-3",
        active
          ? light
            ? "border-slate-200 bg-slate-100 text-slate-950 font-medium"
            : "border-white/10 bg-white/[0.08] text-white font-medium"
          : light
            ? "hover:border-slate-200/60 hover:bg-slate-50 text-slate-700 hover:text-slate-950"
            : "hover:border-white/[0.06] hover:bg-white/[0.04] text-zinc-300 hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border transition-colors",
          dense ? "h-7 w-7" : "h-9 w-9",
          active
            ? light
              ? "border-slate-300 bg-white text-slate-900 shadow-2xs"
              : "border-white/15 bg-white/10 text-white shadow-2xs"
            : light
              ? "border-slate-200 bg-white text-slate-500 group-hover/item:text-slate-900 group-hover/item:border-slate-300"
              : "border-white/10 bg-white/[0.03] text-zinc-400 group-hover/item:text-white group-hover/item:border-white/20"
        )}
      >
        <Icon className={cn("stroke-[1.8]", dense ? "h-3.5 w-3.5" : "h-[18px] w-[18px]")} aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate",
            dense ? "text-xs font-medium" : "text-sm font-semibold",
            active
              ? light ? "text-slate-950 font-semibold" : "text-white font-semibold"
              : light ? "text-slate-800" : "text-zinc-200"
          )}
        >
          {item.label}
        </span>
        {item.description ? (
          <span
            className={cn(
              "mt-0.5 block truncate",
              dense ? "text-[10px]" : "text-[11px]",
              light ? "text-slate-500" : "text-zinc-400"
            )}
          >
            {item.description}
          </span>
        ) : null}
      </span>

      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform group-hover/item:translate-x-0.5",
          active
            ? light ? "text-slate-600" : "text-zinc-300"
            : light ? "text-slate-400" : "text-zinc-600"
        )}
        aria-hidden="true"
      />
    </Link>
  );
}

function FlyoutMenu({
  menuId,
  label,
  description,
  icon: Icon,
  items,
  featuredItem,
  footerLink,
  pathname,
  active,
  open,
  onToggle,
  onClose,
  containerRef,
  light,
  suppressTooltip = false,
}: {
  menuId: Exclude<MenuId, "account">;
  label: string;
  description: string;
  icon: LucideIcon;
  items?: FlyoutItem[];
  featuredItem?: FlyoutItem;
  footerLink?: { href: string; label: string };
  pathname: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  light: boolean;
  suppressTooltip?: boolean;
}) {
  const panelId = `sidebar-${menuId}-menu`;

  return (
    <div ref={containerRef} className="group relative flex w-full items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!open) onToggle();
            focusFirstMenuItem(containerRef);
          }
        }}
        className={navButtonClass({ active, open, light })}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
      >
        {active ? <ActiveRail light={light} /> : null}
        <Icon className="h-[18px] w-[18px] stroke-[1.8] 2xl:h-5 2xl:w-5" aria-hidden="true" />
      </button>
      <SidebarTooltip label={label} subtitle={description} light={light} visible={!open && !suppressTooltip} />

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, x: -8, y: "-50%", scale: 0.985 }}
            animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
            exit={{ opacity: 0, x: -8, y: "-50%", scale: 0.985 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => handleMenuKeyDown(event, onClose, containerRef)}
            className={cn(
              "fixed left-[72px] top-1/2 z-[100] max-h-[calc(100dvh-24px)] w-80 overflow-y-auto rounded-2xl border p-3.5 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.18)] 2xl:left-[84px]",
              light
                ? "border-slate-200 bg-white text-slate-950"
                : "border-white/[0.09] bg-[#111317] text-white shadow-[0_24px_70px_-15px_rgba(0,0,0,0.7)]"
            )}
          >
            <div className={cn("mb-2.5 border-b px-2 pb-3 pt-0.5", light ? "border-slate-200/80" : "border-white/[0.08]")}>
              <p className={cn("text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500")}>{label}</p>
              <p className={cn("mt-0.5 text-xs", light ? "text-slate-600" : "text-zinc-400")}>{description}</p>
            </div>

            {featuredItem ? (
              <div className={cn("mb-2.5 rounded-xl border p-1", light ? "border-slate-200 bg-slate-50/80" : "border-white/[0.07] bg-white/[0.02]")}>
                <FlyoutItemLink
                  item={featuredItem}
                  pathname={pathname}
                  light={light}
                  featured
                  onClose={onClose}
                />
              </div>
            ) : null}

            {items ? (
              <div className="space-y-1">
                {items.map((item) => (
                  <FlyoutItemLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    light={light}
                    onClose={onClose}
                  />
                ))}
              </div>
            ) : null}

            {footerLink ? (
              <div className={cn("mt-2.5 border-t pt-2.5", light ? "border-slate-200/80" : "border-white/[0.08]")}>
                <Link
                  href={footerLink.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    light ? "text-blue-600 hover:bg-blue-50" : "text-blue-400 hover:bg-white/[0.04]"
                  )}
                >
                  <span>{footerLink.label}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AccountLink({
  href,
  icon: Icon,
  label,
  light,
  badge,
  active = false,
  onClick,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  light: boolean;
  badge?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/link flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-sm font-medium outline-none transition-colors",
        active
          ? light
            ? "border-slate-200 bg-slate-100 text-slate-950 font-semibold"
            : "border-white/10 bg-white/[0.08] text-white font-semibold"
          : light
            ? "text-slate-700 hover:border-slate-200/60 hover:bg-slate-50 hover:text-slate-950"
            : "text-zinc-300 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          active
            ? light
              ? "border-slate-300 bg-white text-slate-900 shadow-2xs"
              : "border-white/15 bg-white/10 text-white shadow-2xs"
            : light
              ? "border-slate-200 bg-white text-slate-500 group-hover/link:text-slate-900 group-hover/link:border-slate-300"
              : "border-white/10 bg-white/[0.03] text-zinc-400 group-hover/link:text-white group-hover/link:border-white/20"
        )}
      >
        <Icon className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", light ? "bg-blue-50 text-blue-700 border border-blue-200/60" : "bg-blue-500/10 text-blue-300 border border-blue-400/20")}>
          {badge}
        </span>
      ) : (
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5", light ? "text-slate-400" : "text-zinc-600")} aria-hidden="true" />
      )}
    </Link>
  );
}

function AccountMenu({
  user,
  open,
  onToggle,
  onClose,
  containerRef,
  onSignOut,
  signingOut,
  light,
  pathname,
  suppressTooltip = false,
}: {
  user: User;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSignOut: () => void;
  signingOut: boolean;
  light: boolean;
  pathname: string;
  suppressTooltip?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div ref={containerRef} className="group relative flex w-full items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!open) onToggle();
            focusFirstMenuItem(containerRef);
          }
        }}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-slate-400/50 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9",
          open
            ? light
              ? "bg-slate-100 text-slate-900 border border-slate-300/80"
              : "bg-white/[0.08] text-white border border-white/10"
            : light
              ? "hover:bg-slate-100"
              : "hover:bg-white/[0.06]"
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="sidebar-account-menu"
        aria-label={t("account.label")}
      >
        <Avatar className={cn("h-8 w-8 border 2xl:h-9 2xl:w-9 [@media(max-height:700px)]:h-7 [@media(max-height:700px)]:w-7", light ? "border-slate-200 bg-slate-100" : "border-white/10 bg-zinc-900")}>
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
          <AvatarFallback className={cn("text-xs font-bold", light ? "bg-slate-100 text-slate-700" : "bg-zinc-800 text-zinc-300")}>
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <span className={cn("absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full border-2", light ? "border-white bg-emerald-500" : "border-[#0C0E12] bg-emerald-500")} />
      </button>
      <SidebarTooltip label={user.name || t("account.yourAccount")} subtitle={user.email} light={light} visible={!open && !suppressTooltip} />

      <AnimatePresence>
        {open ? (
          <motion.div
            id="sidebar-account-menu"
            role="menu"
            aria-label={t("account.label")}
            initial={{ opacity: 0, x: -8, y: 6, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, y: 6, scale: 0.985 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => handleMenuKeyDown(event, onClose, containerRef)}
            className={cn(
              "fixed bottom-3 left-[72px] z-[100] max-h-[calc(100dvh-24px)] w-80 overflow-y-auto rounded-2xl border p-3 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.22)] 2xl:left-[84px]",
              light ? "border-slate-200 bg-white" : "border-white/[0.09] bg-[#111317] text-white shadow-[0_24px_70px_-15px_rgba(0,0,0,0.7)]"
            )}
          >
            <div className={cn("flex items-center gap-3 rounded-xl border p-3", light ? "border-slate-200/80 bg-slate-50/80" : "border-white/[0.08] bg-white/[0.03]")}>
              <Avatar className={cn("h-10 w-10 border", light ? "border-slate-200" : "border-white/10")}>
                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
                <AvatarFallback className={cn("font-bold text-sm", light ? "bg-white text-slate-700" : "bg-zinc-800 text-zinc-300")}>
                  {user.name?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-semibold", light ? "text-slate-950" : "text-white")}>{user.name || t("account.userFallback")}</p>
                <p className={cn("mt-0.5 truncate text-xs", light ? "text-slate-500" : "text-zinc-400")}>{user.email}</p>
              </div>
            </div>

            <div className="mt-2.5 space-y-0.5">
              <p className={cn("px-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest", light ? "text-slate-400" : "text-zinc-500")}>{t("account.manage")}</p>
              <AccountLink href="/settings/profile" icon={UserRound} label={t("account.profile")} light={light} active={routeIsActive(pathname, "/settings/profile")} onClick={onClose} />
              <AccountLink href="/settings/workspace" icon={Settings2} label={t("account.settings")} light={light} active={routeIsActive(pathname, "/settings/workspace")} onClick={onClose} />
              <AccountLink href="/settings/billing" icon={CreditCard} label={t("account.billing")} light={light} active={routeIsActive(pathname, "/settings/billing")} onClick={onClose} />
            </div>

            <div className={cn("mt-2.5 border-t pt-2.5", light ? "border-slate-200/80" : "border-white/[0.08]")}>
              <p className={cn("px-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest", light ? "text-slate-400" : "text-zinc-500")}>{t("account.benefits")}</p>
              <AccountLink
                href="/referrals"
                icon={Gift}
                label={t("nav.referrals")}
                badge={t("account.benefitBadge")}
                light={light}
                active={routeIsActive(pathname, "/referrals")}
                onClick={onClose}
              />
            </div>

            <div className={cn("mt-2.5 border-t pt-2.5", light ? "border-slate-200/80" : "border-white/[0.08]")}>
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                disabled={signingOut}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium outline-none transition-colors disabled:cursor-wait disabled:opacity-60",
                  light
                    ? "border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100/70"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15"
                )}
              >
                <LogOut className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
                {signingOut ? t("account.signingOut") : t("account.signOut")}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface SidebarProps {
  user: User;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [mounted, setMounted] = useState(false);

  const initialTheme = user.themePreference === "light" || user.themePreference === "dark"
    ? user.themePreference
    : "dark";
  const light = (mounted ? resolvedTheme ?? initialTheme : initialTheme) === "light";

  const clientsRef = useRef<HTMLDivElement>(null);
  const automationRef = useRef<HTMLDivElement>(null);
  const integrationsRef = useRef<HTMLDivElement>(null);
  const teamRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const clientsItems = useMemo(
    () => clientsNavItems.map((item) => translateItem(item, t)),
    [t]
  );
  const automationItems = useMemo(
    () => automationNavItems.map((item) => translateItem(item, t)),
    [t]
  );
  const teamItems = useMemo(() => {
    const items = [...baseTeamNavItems];
    if (user.is_superadmin) {
      items.push({
        href: "/team/logs",
        icon: ScrollText,
        labelKey: "nav.teamLogs",
        descriptionKey: "nav.teamLogsDescription",
      });
    }
    return items.map((item) => translateItem(item, t));
  }, [t, user.is_superadmin]);

  const integrationFeaturedItem = useMemo(
    () => translateItem(integrationsCatalogItem, t),
    [t]
  );

  const integrationItems = useMemo(
    () => integrationsKeyHubs.map((item) => translateItem(item, t)),
    [t]
  );

  const clientsActive = clientsNavItems.some((item) => routeIsActive(pathname, item.href, item.exact));
  const automationActive = automationNavItems.some((item) => routeIsActive(pathname, item.href, item.exact));
  const integrationsActive = pathname === "/integrations" || pathname.startsWith("/integrations/");
  const teamActive = pathname === "/team" || pathname.startsWith("/team/");

  // Quando qualquer menu estiver aberto, suprimimos os tooltips de fundo para não poluir
  const hasOpenMenu = openMenu !== null;

  const [hasUnreadUpdates, setHasUnreadUpdates] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkUnread() {
      try {
        const unread = await getHasUnreadProductUpdatesAction();
        if (active) setHasUnreadUpdates(unread);
      } catch (err) {
        console.error("Failed to check unread updates:", err);
      }
    }
    void checkUnread();

    try {
      const supabase = createClient();
      const channel = supabase
        .channel(PRODUCT_UPDATES_REALTIME_TOPIC, { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, () => void checkUnread())
        .on("broadcast", { event: "UPDATE" }, () => void checkUnread())
        .subscribe();

      return () => {
        active = false;
        void supabase.removeChannel(channel);
      };
    } catch {
      return () => {
        active = false;
      };
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    const getActiveRef = () => openMenu === "clients"
      ? clientsRef.current
      : openMenu === "automation"
        ? automationRef.current
        : openMenu === "integrations"
          ? integrationsRef.current
          : openMenu === "team"
            ? teamRef.current
            : accountRef.current;

    const handleClickOutside = (event: MouseEvent) => {
      if (!openMenu) return;

      const activeRef = getActiveRef();

      if (activeRef && !activeRef.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openMenu) {
        const activeRef = getActiveRef();
        setOpenMenu(null);
        if (activeRef) restoreMenuTriggerFocus({ current: activeRef });
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openMenu]);

  const toggleMenu = (menu: MenuId) => {
    setOpenMenu((current) => current === menu ? null : menu);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);

    try {
      if (user.activeWorkspaceId) {
        try {
          await fetch("/api/users/online-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: user.activeWorkspaceId,
              isOnline: false,
              forceOffline: true,
              source: "logout",
            }),
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
      aria-label={t("nav.primaryNavigation")}
      className={cn(
        "relative z-50 flex h-full w-16 shrink-0 flex-col items-center border-r px-2 py-3.5 2xl:w-[72px] 2xl:px-2.5 2xl:py-4 [@media(max-height:700px)]:py-2",
        light
          ? "border-slate-200/90 bg-white shadow-[1px_0_3px_rgba(0,0,0,0.03)]"
          : "border-white/[0.07] bg-[#0c0e12] shadow-[1px_0_3px_rgba(0,0,0,0.4)]"
      )}
    >
      {/* Top Header: Logo + Workspace */}
      <div className="flex w-full shrink-0 flex-col items-center gap-2 [@media(max-height:700px)]:gap-1.5">
        <Link
          href="/inbox"
          prefetch={false}
          aria-label="Dialogy"
          className={cn(
            "group flex h-10 w-10 items-center justify-center rounded-xl border outline-none transition-all focus-visible:ring-2 focus-visible:ring-slate-400/50 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9",
            light
              ? "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-slate-100/80"
              : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]"
          )}
        >
          <DialogyLogo />
        </Link>

        <WorkspaceSwitcher
          user={user}
          className={cn(
            "[&>button]:shadow-none",
            light
              ? "[&>button]:border-slate-200 [&>button]:bg-slate-50/80 [&>button]:hover:border-slate-300 [&>button]:hover:bg-slate-100/80"
              : "[&>button]:border-white/10 [&>button]:bg-white/[0.04] [&>button]:hover:border-white/20 [&>button]:hover:bg-white/[0.08]"
          )}
        />
      </div>

      {/* Hairline Divider */}
      <div className={cn("my-3 h-px w-8 shrink-0 [@media(max-height:700px)]:my-2", light ? "bg-slate-200/90" : "bg-white/[0.08]")} />

      {/* Primary Center Navigation */}
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1.5 [@media(max-height:700px)]:gap-1" aria-label={t("nav.primaryNavigation")}>
        <SidebarIconLink
          item={inboxNavItem}
          label={t(inboxNavItem.labelKey)}
          subtitle="Central de conversas"
          active={routeIsActive(pathname, inboxNavItem.href)}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <FlyoutMenu
          menuId="clients"
          label={t("nav.clients")}
          description={t("nav.clientsMenuDescription")}
          icon={ContactRound}
          items={clientsItems}
          pathname={pathname}
          active={clientsActive}
          open={openMenu === "clients"}
          onToggle={() => toggleMenu("clients")}
          onClose={() => setOpenMenu(null)}
          containerRef={clientsRef}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <FlyoutMenu
          menuId="automation"
          label={t("nav.automationAi")}
          description={t("nav.automationMenuDescription")}
          icon={Sparkles}
          items={automationItems}
          pathname={pathname}
          active={automationActive}
          open={openMenu === "automation"}
          onToggle={() => toggleMenu("automation")}
          onClose={() => setOpenMenu(null)}
          containerRef={automationRef}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <FlyoutMenu
          menuId="integrations"
          label={t("nav.integrations")}
          description={t("nav.integrationsMenuDescription")}
          icon={Cable}
          featuredItem={integrationFeaturedItem}
          items={integrationItems}
          footerLink={{ href: "/integrations", label: "Explorar catálogo completo" }}
          pathname={pathname}
          active={integrationsActive}
          open={openMenu === "integrations"}
          onToggle={() => toggleMenu("integrations")}
          onClose={() => setOpenMenu(null)}
          containerRef={integrationsRef}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <FlyoutMenu
          menuId="team"
          label={t("nav.team")}
          description={t("nav.teamMenuDescription")}
          icon={Users}
          items={teamItems}
          pathname={pathname}
          active={teamActive}
          open={openMenu === "team"}
          onToggle={() => toggleMenu("team")}
          onClose={() => setOpenMenu(null)}
          containerRef={teamRef}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <SidebarIconLink
          item={communityNavItem}
          label={t(communityNavItem.labelKey)}
          subtitle="Feed social e novidades"
          active={routeIsActive(pathname, communityNavItem.href)}
          light={light}
          suppressTooltip={hasOpenMenu}
          badgeRed={hasUnreadUpdates && !routeIsActive(pathname, communityNavItem.href)}
        />
      </nav>

      {/* Bottom Actions (Configurações agora vive com exclusividade no menu do avatar, eliminando duplicata da barra) */}
      <div className="flex w-full shrink-0 flex-col items-center gap-1 [@media(max-height:700px)]:gap-0.5">
        <div className={cn("my-2.5 h-px w-8 [@media(max-height:700px)]:my-1", light ? "bg-slate-200/90" : "bg-white/[0.08]")} />

        <SidebarIconLink
          item={helpNavItem}
          label={t(helpNavItem.labelKey)}
          subtitle="Tutoriais e suporte"
          active={routeIsActive(pathname, helpNavItem.href)}
          light={light}
          suppressTooltip={hasOpenMenu}
        />

        <div className="group relative flex w-full items-center justify-center [&>button]:h-10 [&>button]:w-10 [&>button]:rounded-xl 2xl:[&>button]:h-11 2xl:[&>button]:w-11 [@media(max-height:700px)]:[&>button]:h-9 [@media(max-height:700px)]:[&>button]:w-9">
          <LanguageToggle />
          <SidebarTooltip label={t("language.label")} subtitle="Selecionar idioma" light={light} visible={!hasOpenMenu} />
        </div>

        <AccountMenu
          user={user}
          open={openMenu === "account"}
          onToggle={() => toggleMenu("account")}
          onClose={() => setOpenMenu(null)}
          containerRef={accountRef}
          onSignOut={handleSignOut}
          signingOut={signingOut}
          light={light}
          pathname={pathname}
          suppressTooltip={hasOpenMenu}
        />
      </div>
    </aside>
  );
}
