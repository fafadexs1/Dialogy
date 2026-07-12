"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart2,
  Bot,
  BrainCircuit,
  Building2,
  Cable,
  ChevronRight,
  CircleHelp,
  ContactRound,
  CreditCard,
  Fingerprint,
  Gift,
  Inbox,
  Instagram,
  LayoutGrid,
  LogOut,
  LucideIcon,
  MessageCircleMore,
  Network,
  RadioTower,
  ScrollText,
  Send,
  Settings2,
  Sparkles,
  Store,
  Truck,
  UserRound,
  Users,
  UsersRound,
  Webhook,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { signOut } from "@/actions/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { useI18n } from "@/i18n/i18n-provider";
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

type FlyoutSectionConfig = {
  id: string;
  labelKey: string;
  items: NavItem[];
};

type FlyoutSection = {
  id: string;
  label: string;
  items: FlyoutItem[];
};

const inboxNavItem: NavItem = {
  href: "/inbox",
  icon: Inbox,
  labelKey: "nav.inbox",
};

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

const automationNavItems: NavItem[] = [
  {
    href: "/autopilot",
    icon: BrainCircuit,
    labelKey: "nav.autopilot",
    descriptionKey: "nav.autopilotDescription",
  },
  {
    href: "/automations/robots",
    icon: Bot,
    labelKey: "nav.systemAgents",
    descriptionKey: "nav.systemAgentsDescription",
  },
  {
    href: "/nexus",
    icon: Sparkles,
    labelKey: "nav.nexus",
    descriptionKey: "nav.nexusDescription",
  },
];

const teamNavItems: NavItem[] = [
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
  {
    href: "/team/logs",
    icon: ScrollText,
    labelKey: "nav.teamLogs",
    descriptionKey: "nav.teamLogsDescription",
  },
];

const integrationsCatalogItem: NavItem = {
  href: "/integrations",
  icon: LayoutGrid,
  labelKey: "nav.integrationsCatalog",
  descriptionKey: "nav.integrationsCatalogDescription",
  exact: true,
};

const integrationNavSections: FlyoutSectionConfig[] = [
  {
    id: "channels",
    labelKey: "nav.channels",
    items: [
      {
        href: "/integrations/evolution-api",
        icon: MessageCircleMore,
        labelKey: "nav.whatsapp",
        descriptionKey: "nav.whatsappDescription",
      },
      {
        href: "/integrations/meta-instagram",
        icon: Instagram,
        labelKey: "nav.instagram",
        descriptionKey: "nav.instagramDescription",
      },
      {
        href: "/integrations/meta-messenger",
        icon: MessageCircleMore,
        labelKey: "nav.messenger",
        descriptionKey: "nav.messengerDescription",
      },
      {
        href: "/integrations/telegram",
        icon: Send,
        labelKey: "nav.telegram",
        descriptionKey: "nav.telegramDescription",
      },
    ],
  },
  {
    id: "ai-tools",
    labelKey: "nav.aiAndTools",
    items: [
      {
        href: "/integrations/ai",
        icon: BrainCircuit,
        labelKey: "nav.aiProviders",
        descriptionKey: "nav.aiProvidersDescription",
      },
      {
        href: "/integrations/mcp",
        icon: Webhook,
        labelKey: "nav.mcp",
        descriptionKey: "nav.mcpDescription",
      },
      {
        href: "/integrations/nexusflow",
        icon: Network,
        labelKey: "nav.nexusIntegration",
        descriptionKey: "nav.nexusIntegrationDescription",
      },
    ],
  },
  {
    id: "business",
    labelKey: "nav.businessOperations",
    items: [
      {
        href: "/integrations/sgp",
        icon: Building2,
        labelKey: "nav.sgp",
        descriptionKey: "nav.sgpDescription",
      },
      {
        href: "/integrations/mercadolivre",
        icon: Store,
        labelKey: "nav.mercadoLivre",
        descriptionKey: "nav.mercadoLivreDescription",
      },
      {
        href: "/integrations/gads",
        icon: RadioTower,
        labelKey: "nav.googleAds",
        descriptionKey: "nav.googleAdsDescription",
      },
      {
        href: "/integrations/delivery-hub",
        icon: Truck,
        labelKey: "nav.deliveryHub",
        descriptionKey: "nav.deliveryHubDescription",
      },
    ],
  },
];

const helpNavItem: NavItem = {
  href: "/support",
  icon: CircleHelp,
  labelKey: "nav.help",
};

const settingsNavItem: NavItem = {
  href: "/settings",
  icon: Settings2,
  labelKey: "nav.settings",
};

const NAV_BUTTON_CLASS =
  "relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9";

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

function SidebarTooltip({
  label,
  light,
  visible = true,
}: {
  label: string;
  light: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[110] -translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-lg transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100",
        light
          ? "border-slate-200 bg-white text-slate-700"
          : "border-white/10 bg-slate-950 text-slate-100"
      )}
    >
      {label}
    </span>
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
  if (active || open) {
    return cn(
      NAV_BUTTON_CLASS,
      light
        ? "bg-emerald-600 text-white shadow-[0_8px_20px_-12px_rgba(5,150,105,0.9)]"
        : "bg-emerald-400 text-slate-950 shadow-[0_8px_20px_-12px_rgba(52,211,153,0.85)]"
    );
  }

  return cn(
    NAV_BUTTON_CLASS,
    light
      ? "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      : "text-slate-400 hover:bg-white/[0.08] hover:text-white"
  );
}

function ActiveRail({ light }: { light: boolean }) {
  return (
    <motion.span
      layoutId="sidebar-active-rail"
      className={cn(
        "absolute -left-[7px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full",
        light ? "bg-emerald-600" : "bg-emerald-300"
      )}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
    />
  );
}

function SidebarIconLink({
  item,
  label,
  active,
  light,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  light: boolean;
}) {
  const Icon = item.icon;

  return (
    <div className="group relative flex w-full items-center justify-center">
      <Link
        href={item.href}
        prefetch={false}
        className={navButtonClass({ active, light })}
        aria-label={label}
        aria-current={active ? "page" : undefined}
      >
        {active ? <ActiveRail light={light} /> : null}
        <Icon className="h-[18px] w-[18px] stroke-[1.8] 2xl:h-5 2xl:w-5" aria-hidden="true" />
      </Link>
      <SidebarTooltip label={label} light={light} />
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
        "group/item flex min-w-0 items-center rounded-xl border border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500",
        dense ? "gap-2 px-2 py-2" : "gap-3 px-3 py-2.5",
        featured && "px-3.5 py-3",
        active
          ? light
            ? "border-emerald-200 bg-emerald-50"
            : "border-emerald-400/20 bg-emerald-400/10"
          : light
            ? "hover:border-slate-200 hover:bg-slate-50"
            : "hover:border-white/10 hover:bg-white/5"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border transition-colors",
          dense ? "h-8 w-8" : "h-9 w-9",
          active
            ? light
              ? "border-emerald-200 bg-white text-emerald-700"
              : "border-emerald-300/20 bg-emerald-300/10 text-emerald-300"
            : light
              ? "border-slate-200 bg-white text-slate-500 group-hover/item:text-slate-900"
              : "border-white/10 bg-white/5 text-slate-400 group-hover/item:text-white"
        )}
      >
        <Icon className={cn("stroke-[1.8]", dense ? "h-4 w-4" : "h-[18px] w-[18px]")} aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate font-semibold",
            dense ? "text-xs" : "text-sm",
            light ? "text-slate-800" : "text-slate-100"
          )}
        >
          {item.label}
        </span>
        {item.description ? (
          <span
            className={cn(
              "mt-0.5 block truncate",
              dense ? "text-[10px]" : "text-[11px]",
              light ? "text-slate-500" : "text-slate-500"
            )}
          >
            {item.description}
          </span>
        ) : null}
      </span>

      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform group-hover/item:translate-x-0.5",
          light ? "text-slate-400" : "text-slate-600"
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
  sections,
  featuredItem,
  pathname,
  active,
  open,
  onToggle,
  onClose,
  containerRef,
  light,
  wide = false,
}: {
  menuId: Exclude<MenuId, "account">;
  label: string;
  description: string;
  icon: LucideIcon;
  items?: FlyoutItem[];
  sections?: FlyoutSection[];
  featuredItem?: FlyoutItem;
  pathname: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  light: boolean;
  wide?: boolean;
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
      <SidebarTooltip label={label} light={light} visible={!open} />

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, x: -8, y: "-50%", scale: 0.985 }}
            animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
            exit={{ opacity: 0, x: -8, y: "-50%", scale: 0.985 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => handleMenuKeyDown(event, onClose, containerRef)}
            className={cn(
              "fixed left-[76px] top-1/2 z-[100] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border p-3 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.35)] 2xl:left-[90px]",
              wide ? "w-[min(720px,calc(100vw-92px))]" : "w-80",
              light
                ? "border-slate-200 bg-white text-slate-950"
                : "border-white/10 bg-[#111418] text-white"
            )}
          >
            <div className={cn("mb-2 border-b px-2 pb-3 pt-1", light ? "border-slate-200" : "border-white/10")}>
              <p className={cn("text-sm font-bold tracking-tight", light ? "text-slate-950" : "text-white")}>{label}</p>
              <p className={cn("mt-0.5 text-[11px]", light ? "text-slate-500" : "text-slate-400")}>{description}</p>
            </div>

            {featuredItem ? (
              <div className={cn("mb-3 rounded-xl border p-1", light ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]")}>
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

            {sections ? (
              <div className="grid grid-cols-3 gap-2.5">
                {sections.map((section) => (
                  <section
                    key={section.id}
                    className={cn(
                      "min-w-0 rounded-xl border p-2",
                      light ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-white/[0.025]"
                    )}
                  >
                    <h3 className={cn("px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em]", light ? "text-slate-500" : "text-slate-500")}>
                      {section.label}
                    </h3>
                    <div className="space-y-0.5">
                      {section.items.map((item) => (
                        <FlyoutItemLink
                          key={item.href}
                          item={item}
                          pathname={pathname}
                          light={light}
                          dense
                          onClose={onClose}
                        />
                      ))}
                    </div>
                  </section>
                ))}
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
        "group/link flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500",
        active
          ? light
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
          : light
            ? "text-slate-700 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950"
            : "text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          light ? "border-slate-200 bg-white text-slate-500" : "border-white/10 bg-white/5 text-slate-400"
        )}
      >
        <Icon className="h-4 w-4 stroke-[1.8]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", light ? "bg-emerald-50 text-emerald-700" : "bg-emerald-400/10 text-emerald-300")}>
          {badge}
        </span>
      ) : (
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5", light ? "text-slate-400" : "text-slate-600")} aria-hidden="true" />
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
          "relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9",
          open
            ? light
              ? "bg-slate-100"
              : "bg-white/10"
            : light
              ? "hover:bg-slate-100"
              : "hover:bg-white/[0.08]"
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="sidebar-account-menu"
        aria-label={t("account.label")}
      >
        <Avatar className={cn("h-8 w-8 border 2xl:h-9 2xl:w-9 [@media(max-height:700px)]:h-7 [@media(max-height:700px)]:w-7", light ? "border-slate-200 bg-slate-100" : "border-white/10 bg-slate-900")}>
          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
          <AvatarFallback className={cn("text-xs font-bold", light ? "bg-slate-100 text-slate-600" : "bg-slate-800 text-slate-300")}>
            {user.name?.charAt(0).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <span className={cn("absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full border-2", light ? "border-white bg-emerald-500" : "border-[#0B0D10] bg-emerald-400")} />
      </button>
      <SidebarTooltip label={user.name || t("account.yourAccount")} light={light} visible={!open} />

      <AnimatePresence>
        {open ? (
          <motion.div
            id="sidebar-account-menu"
            role="menu"
            aria-label={t("account.label")}
            initial={{ opacity: 0, x: -8, y: 6, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, y: 6, scale: 0.985 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => handleMenuKeyDown(event, onClose, containerRef)}
            className={cn(
              "fixed bottom-3 left-[76px] z-[100] max-h-[calc(100dvh-24px)] w-80 overflow-y-auto rounded-2xl border p-3 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.4)] 2xl:left-[90px]",
              light ? "border-slate-200 bg-white" : "border-white/10 bg-[#111418]"
            )}
          >
            <div className={cn("flex items-center gap-3 rounded-xl border p-3", light ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.035]")}>
              <Avatar className={cn("h-10 w-10 border", light ? "border-slate-200" : "border-white/10")}>
                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} className="object-cover" /> : null}
                <AvatarFallback className={cn("font-bold", light ? "bg-white text-slate-600" : "bg-slate-800 text-slate-300")}>
                  {user.name?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-bold", light ? "text-slate-950" : "text-white")}>{user.name || t("account.userFallback")}</p>
                <p className={cn("mt-0.5 truncate text-xs", light ? "text-slate-500" : "text-slate-400")}>{user.email}</p>
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <p className={cn("px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em]", light ? "text-slate-400" : "text-slate-500")}>{t("account.manage")}</p>
              <AccountLink href="/settings/profile" icon={UserRound} label={t("account.profile")} light={light} active={routeIsActive(pathname, "/settings/profile")} onClick={onClose} />
              <AccountLink href="/settings/billing" icon={CreditCard} label={t("account.billing")} light={light} active={routeIsActive(pathname, "/settings/billing")} onClick={onClose} />
              {user.is_superadmin ? (
                <AccountLink href="/team/logs" icon={ScrollText} label={t("account.systemLogs")} light={light} active={routeIsActive(pathname, "/team/logs")} onClick={onClose} />
              ) : null}
            </div>

            <div className={cn("mt-3 border-t pt-3", light ? "border-slate-200" : "border-white/10")}>
              <p className={cn("px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em]", light ? "text-slate-400" : "text-slate-500")}>{t("account.benefits")}</p>
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

            <div className={cn("mt-3 border-t pt-3", light ? "border-slate-200" : "border-white/10")}>
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                disabled={signingOut}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-wait disabled:opacity-60",
                  light
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/15"
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
  const teamItems = useMemo(
    () => teamNavItems.map((item) => translateItem(item, t)),
    [t]
  );
  const integrationFeaturedItem = useMemo(
    () => translateItem(integrationsCatalogItem, t),
    [t]
  );
  const integrationSections = useMemo(
    () => integrationNavSections.map((section) => ({
      id: section.id,
      label: t(section.labelKey),
      items: section.items.map((item) => translateItem(item, t)),
    })),
    [t]
  );

  const clientsActive = clientsNavItems.some((item) => routeIsActive(pathname, item.href, item.exact));
  const automationActive = automationNavItems.some((item) => routeIsActive(pathname, item.href, item.exact));
  const integrationsActive = pathname === "/integrations" || pathname.startsWith("/integrations/");
  const teamActive = pathname === "/team" || pathname.startsWith("/team/");

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
        "relative z-50 flex h-full w-16 shrink-0 flex-col items-center border-r px-2 py-3 2xl:w-[78px] 2xl:px-3 2xl:py-4 [@media(max-height:700px)]:py-2",
        light
          ? "border-slate-200 bg-white shadow-[10px_0_30px_-28px_rgba(15,23,42,0.35)]"
          : "border-white/10 bg-[#0B0D10] shadow-[10px_0_30px_-28px_rgba(0,0,0,0.9)]"
      )}
    >
      <div className="flex w-full shrink-0 flex-col items-center gap-2.5 [@media(max-height:700px)]:gap-1.5">
        <Link
          href="/inbox"
          prefetch={false}
          aria-label="Dialogy"
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 2xl:h-11 2xl:w-11 [@media(max-height:700px)]:h-9 [@media(max-height:700px)]:w-9",
            light
              ? "border-slate-200 bg-slate-50 hover:border-emerald-200 hover:bg-emerald-50"
              : "border-white/10 bg-white/5 hover:border-emerald-400/30 hover:bg-emerald-400/10"
          )}
        >
          <DialogyLogo />
        </Link>

        <WorkspaceSwitcher
          user={user}
          className={cn(
            "[&>button]:shadow-none",
            light
              ? "[&>button]:border-slate-200 [&>button]:bg-slate-50 [&>button]:hover:border-emerald-200 [&>button]:hover:bg-emerald-50"
              : "[&>button]:border-white/10 [&>button]:bg-white/5 [&>button]:hover:border-emerald-400/30 [&>button]:hover:bg-emerald-400/10"
          )}
        />
      </div>

      <div className={cn("my-3 h-px w-7 shrink-0 [@media(max-height:700px)]:my-2", light ? "bg-slate-200" : "bg-white/10")} />

      <nav className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1.5 [@media(max-height:700px)]:gap-1" aria-label={t("nav.primaryNavigation")}>
        <SidebarIconLink
          item={inboxNavItem}
          label={t(inboxNavItem.labelKey)}
          active={routeIsActive(pathname, inboxNavItem.href)}
          light={light}
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
        />

        <FlyoutMenu
          menuId="automation"
          label={t("nav.automationAi")}
          description={t("nav.automationMenuDescription")}
          icon={Workflow}
          items={automationItems}
          pathname={pathname}
          active={automationActive}
          open={openMenu === "automation"}
          onToggle={() => toggleMenu("automation")}
          onClose={() => setOpenMenu(null)}
          containerRef={automationRef}
          light={light}
        />

        <FlyoutMenu
          menuId="integrations"
          label={t("nav.integrations")}
          description={t("nav.integrationsMenuDescription")}
          icon={Cable}
          sections={integrationSections}
          featuredItem={integrationFeaturedItem}
          pathname={pathname}
          active={integrationsActive}
          open={openMenu === "integrations"}
          onToggle={() => toggleMenu("integrations")}
          onClose={() => setOpenMenu(null)}
          containerRef={integrationsRef}
          light={light}
          wide
        />

        <FlyoutMenu
          menuId="team"
          label={t("nav.team")}
          description={t("nav.teamMenuDescription")}
          icon={UsersRound}
          items={teamItems}
          pathname={pathname}
          active={teamActive}
          open={openMenu === "team"}
          onToggle={() => toggleMenu("team")}
          onClose={() => setOpenMenu(null)}
          containerRef={teamRef}
          light={light}
        />
      </nav>

      <div className="flex w-full shrink-0 flex-col items-center gap-1 [@media(max-height:700px)]:gap-0.5">
        <div className={cn("my-2 h-px w-7 [@media(max-height:700px)]:my-1", light ? "bg-slate-200" : "bg-white/10")} />

        <SidebarIconLink
          item={helpNavItem}
          label={t(helpNavItem.labelKey)}
          active={routeIsActive(pathname, helpNavItem.href)}
          light={light}
        />
        <SidebarIconLink
          item={settingsNavItem}
          label={t(settingsNavItem.labelKey)}
          active={routeIsActive(pathname, settingsNavItem.href)}
          light={light}
        />

        <div className={cn("my-1.5 h-px w-7 [@media(max-height:700px)]:my-1", light ? "bg-slate-200" : "bg-white/10")} />

        <div className="group relative flex w-full items-center justify-center [&>button]:h-10 [&>button]:w-10 [&>button]:rounded-xl 2xl:[&>button]:h-11 2xl:[&>button]:w-11 [@media(max-height:700px)]:[&>button]:h-9 [@media(max-height:700px)]:[&>button]:w-9">
          <LanguageToggle />
          <SidebarTooltip label={t("language.label")} light={light} />
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
        />
      </div>
    </aside>
  );
}
