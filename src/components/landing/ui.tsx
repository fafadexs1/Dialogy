'use client';

import React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

// --- Design Tokens ---
export const primary = "hsl(var(--primary))";
export const secondary = "hsl(var(--secondary))";
export const accent = "hsl(var(--accent))";
export const darkBg = "#020817";

export const glass = "backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 shadow-xl shadow-black/20";
export const glow = "shadow-[0_0_40px_rgba(59,130,246,0.15)] hover:shadow-[0_0_60px_rgba(139,92,246,0.3)]";

// --- Components ---

export function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
    return <section id={id} className={`w-full max-w-7xl mx-auto px-6 md:px-8 relative z-10 ${className}`}>{children}</section>;
}

export function Badge({ children, className = "" }: { children: React.ReactNode, className?: string }) {
    return (
        <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs md:text-sm font-medium border border-border bg-muted/50 text-foreground/90 ${className}`}>
            <Sparkles className="w-3.5 h-3.5 text-yellow-500" /> {children}
        </span>
    );
}

export function CTAButton({
    children,
    variant = "primary",
    href,
    className = "",
    onClick,
    disabled = false
}: {
    children: React.ReactNode;
    variant?: "primary" | "outline" | "ghost",
    href?: string,
    className?: string,
    onClick?: () => void,
    disabled?: boolean
}) {
    const base = "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 font-semibold transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    const content = (
        <>
            {children}
        </>
    );

    const classes = variant === "outline"
        ? `${base} border border-white/20 text-white hover:bg-white/10 ${className}`
        : variant === "ghost"
            ? `${base} text-muted-foreground hover:text-foreground hover:bg-muted/50 ${className}`
            : `${base} text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 border border-blue-500/20 ${className}`;

    const style = {};

    if (onClick || !href) {
        return (
            <button onClick={onClick} disabled={disabled} className={classes} style={style}>
                {content}
            </button>
        );
    }

    return (
        <Link href={href} className={classes} style={style}>
            {content}
        </Link>
    );
};

export function GradientOrb({ className = "", color = primary }: { className?: string, color?: string }) {
    return (
        <div
            aria-hidden
            className={`pointer-events-none absolute rounded-full blur-[100px] opacity-40 mix-blend-screen ${className}`}
            style={{ background: color }}
        />
    );
}
