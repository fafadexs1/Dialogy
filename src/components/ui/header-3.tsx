'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { BrandMark } from '@/components/landing/BrandMark';
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import { LucideIcon } from 'lucide-react';
import {
	CodeIcon,
	GlobeIcon,
	LayersIcon,
	UserPlusIcon,
	Users,
	Star,
	FileText,
	Shield,
	RotateCcw,
	Handshake,
	Leaf,
	HelpCircle,
	BarChart,
	PlugIcon,
	ArrowRight
} from 'lucide-react';
import { ShinyButton } from '@/components/ui/shiny-button';

type LinkItem = {
	title: string;
	href: string;
	icon: LucideIcon;
	description?: string;
};

export function Header() {
	const [open, setOpen] = React.useState(false);
	const scrolled = useScroll(10);

	React.useEffect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [open]);

	return (
		<header
			className={cn('sticky top-0 z-50 w-full border-b border-white/5 bg-black transition-all duration-300')}
		>
			<nav className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 md:px-8">
				{/* Left: Logo */}
				<div className="flex flex-1 items-center justify-start">
					<Link href="/" className="hover:opacity-80 transition-opacity">
						<BrandMark labelClassName="text-white" />
					</Link>
				</div>

				{/* Center: Navigation Menu */}
				<div className="flex flex-1 items-center justify-center">
					<NavigationMenu className="hidden lg:flex">
						<NavigationMenuList>
							<NavigationMenuItem>
								<NavigationMenuTrigger className="bg-transparent text-white/70 hover:text-white data-[state=open]:text-white">Soluções</NavigationMenuTrigger>
								<NavigationMenuContent className="bg-black border-white/10 p-1">
									<ul className="grid w-[600px] grid-cols-2 gap-2 p-2">
										{productLinks.map((item, i) => (
											<li key={i}>
												<ListItem {...item} />
											</li>
										))}
									</ul>
									<div className="p-4 border-t border-white/5 bg-white/5">
										<p className="text-white/50 text-sm">
											Precisa de algo sob medida?{' '}
											<a href="https://wa.me/551151994714" target="_blank" rel="noopener noreferrer" className="text-brand-green font-medium hover:underline">
												Fale com um especialista
											</a>
										</p>
									</div>
								</NavigationMenuContent>
							</NavigationMenuItem>
							<NavigationMenuItem>
								<NavigationMenuTrigger className="bg-transparent text-white/70 hover:text-white data-[state=open]:text-white">Plataforma</NavigationMenuTrigger>
								<NavigationMenuContent className="bg-black border-white/10 p-1 pb-2">
									<div className="grid w-[600px] grid-cols-2 gap-2">
										<ul className="space-y-1 p-2">
											{companyLinks.map((item, i) => (
												<li key={i}>
													<ListItem {...item} />
												</li>
											))}
										</ul>
										<ul className="space-y-1 p-3">
											{companyLinks2.map((item, i) => (
												<li key={i}>
													<NavigationMenuLink
														href={item.href}
														className="flex p-2 hover:bg-white/5 flex-row rounded-md items-center gap-x-3 transition-colors group"
													>
														<item.icon className="text-white/40 size-4 group-hover:text-brand-green transition-colors" />
														<span className="font-medium text-white/70 group-hover:text-white text-sm">{item.title}</span>
													</NavigationMenuLink>
												</li>
											))}
										</ul>
									</div>
								</NavigationMenuContent>
							</NavigationMenuItem>
							<NavigationMenuLink asChild>
								<Link href="/pricing" className="text-sm font-medium text-white/70 hover:text-white px-4 py-2 transition-colors">
									Preços
								</Link>
							</NavigationMenuLink>
						</NavigationMenuList>
					</NavigationMenu>
				</div>

				{/* Right: Auth Actions */}
				<div className="flex flex-1 items-center justify-end gap-4">
					<div className="hidden items-center gap-4 lg:flex">
						<Link href="/login" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
							Login
						</Link>
						<Link href="/pricing">
							<ShinyButton>
								Começar agora
							</ShinyButton>
						</Link>
					</div>
					<Button
						size="icon"
						variant="ghost"
						onClick={() => setOpen(!open)}
						className="lg:hidden text-white hover:bg-white/10"
						aria-expanded={open}
						aria-controls="mobile-menu"
						aria-label="Toggle menu"
					>
						<MenuToggleIcon open={open} className="size-6" duration={300} />
					</Button>
				</div>
			</nav>
			<MobileMenu open={open} className="flex flex-col justify-between gap-6 overflow-y-auto">
				<div className="flex w-full flex-col gap-y-6">
					<div className="space-y-4">
						<span className="text-xs font-bold uppercase tracking-widest text-white/30 px-2">Soluções</span>
						<div className="grid grid-cols-1 gap-1">
							{productLinks.map((link) => (
								<MobileListItem key={link.title} {...link} />
							))}
						</div>
					</div>
					<div className="space-y-4">
						<span className="text-xs font-bold uppercase tracking-widest text-white/30 px-2">Plataforma</span>
						<div className="grid grid-cols-1 gap-1">
							{companyLinks.map((link) => (
								<MobileListItem key={link.title} {...link} />
							))}
							{companyLinks2.map((link) => (
								<MobileListItem key={link.title} {...link} />
							))}
						</div>
					</div>
				</div>
				<div className="flex flex-col gap-3 pt-6 border-t border-white/10">
					<Link href="/login">
						<Button variant="outline" className="w-full border-white/10 bg-transparent text-white hover:bg-white/5">
							Login
						</Button>
					</Link>
					<Link href="/pricing" className="w-full">
						<ShinyButton className="w-full">
							Começar agora
						</ShinyButton>
					</Link>
				</div>
			</MobileMenu>
		</header>
	);
}

type MobileMenuProps = React.ComponentProps<'div'> & {
	open: boolean;
};

function MobileMenu({ open, children, className, ...props }: MobileMenuProps) {
	if (!open || typeof window === 'undefined') return null;

	return createPortal(
		<div
			id="mobile-menu"
			className={cn(
				'bg-black',
				'fixed top-16 right-0 bottom-0 left-0 z-[100] flex flex-col overflow-hidden md:hidden',
			)}
		>
			<div
				data-slot={open ? 'open' : 'closed'}
				className={cn(
					'data-[slot=open]:animate-in data-[slot=open]:slide-in-from-top-5 ease-out duration-300',
					'size-full p-6',
					className,
				)}
				{...props}
			>
				{children}
			</div>
		</div>,
		document.body,
	);
}

function ListItem({
	title,
	description,
	icon: Icon,
	className,
	href,
	...props
}: React.ComponentProps<typeof NavigationMenuLink> & LinkItem) {
	return (
		<NavigationMenuLink className={cn('w-full group flex flex-row gap-x-3 items-start hover:bg-white/5 rounded-xl p-3 transition-all duration-200', className)} {...props} asChild>
			<Link href={href}>
				<div className="flex aspect-square size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 shadow-sm group-hover:border-brand-green/30 group-hover:bg-brand-green/10 transition-colors">
					<Icon className="text-white/70 size-5 group-hover:text-brand-green transition-colors" />
				</div>
				<div className="flex flex-col items-start justify-center">
					<span className="font-medium text-white/90 group-hover:text-white text-sm">{title}</span>
					{description && <span className="text-white/40 text-xs line-clamp-1">{description}</span>}
				</div>
			</Link>
		</NavigationMenuLink>
	);
}

function MobileListItem({
	title,
	description,
	icon: Icon,
	className,
	href,
}: LinkItem & { className?: string }) {
	return (
		<Link
			href={href}
			className={cn('w-full group flex flex-row gap-x-3 items-start hover:bg-white/5 rounded-xl p-3 transition-all duration-200', className)}
		>
			<div className="flex aspect-square size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 shadow-sm group-hover:border-brand-green/30 group-hover:bg-brand-green/10 transition-colors">
				<Icon className="text-white/70 size-5 group-hover:text-brand-green transition-colors" />
			</div>
			<div className="flex flex-col items-start justify-center">
				<span className="font-medium text-white/90 group-hover:text-white text-sm">{title}</span>
				{description && <span className="text-white/40 text-xs line-clamp-1">{description}</span>}
			</div>
		</Link>
	);
}

const productLinks: LinkItem[] = [
	{
		title: 'Omnichannel',
		href: '/#crm-whatsapp',
		description: 'Centralize WhatsApp, Instagram e mais.',
		icon: GlobeIcon,
	},
	{
		title: 'Automações Inteligentes',
		href: '/#journey',
		description: 'Crie fluxos poderosos com IA.',
		icon: LayersIcon,
	},
	{
		title: 'Gestão de Equipe',
		href: '/pricing',
		description: 'Multi-atendentes e departamentos.',
		icon: UserPlusIcon,
	},
	{
		title: 'Analytics & Dashboards',
		href: '/developer/docs/google-ads-whatsapp',
		description: 'Métricas em tempo real da operação.',
		icon: BarChart,
	},
	{
		title: 'Integrações Pro',
		href: '/developer',
		description: 'Webhooks, API e integracoes nativas.',
		icon: PlugIcon,
	},
	{
		title: 'Developer Center',
		href: '/developer',
		description: 'Documentação técnica completa.',
		icon: CodeIcon,
	},
];

const companyLinks: LinkItem[] = [
	{
		title: 'Sobre a Dialogy',
		href: '/about',
		description: 'Nossa missão e visão de futuro.',
		icon: Users,
	},
	{
		title: 'Cases de Sucesso',
		href: '/creators',
		description: 'Como transformamos negócios.',
		icon: Star,
	},
	{
		title: 'Parcerias',
		href: '/developer/community',
		icon: Handshake,
		description: 'Cresça junto com a Dialogy.',
	},
];

const companyLinks2: LinkItem[] = [
	{
		title: 'Termos de Uso',
		href: '/terms',
		icon: FileText,
	},
	{
		title: 'Privacidade',
		href: '/privacy',
		icon: Shield,
	},
	{
		title: 'Blog',
		href: '/developer/community',
		icon: Leaf,
	},
	{
		title: 'Central de Ajuda',
		href: '/support',
		icon: HelpCircle,
	},
];


function useScroll(threshold: number) {
	const [scrolled, setScrolled] = React.useState(false);

	const onScroll = React.useCallback(() => {
		setScrolled(window.scrollY > threshold);
	}, [threshold]);

	React.useEffect(() => {
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, [onScroll]);

	React.useEffect(() => {
		onScroll();
	}, [onScroll]);

	return scrolled;
}
