'use client';

import React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

// --- Design Tokens ---
export const primary = "#3b82f6"; // Blue 500
export const secondary = "#8b5cf6"; // Violet 500
export const accent = "#ec4899"; // Pink 500
export const darkBg = "#030712"; // Gray 950

export const glass = "backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300";
export const glow = "shadow-[0_0_40px_rgba(59,130,246,0.15)] hover:shadow-[0_0_60px_rgba(139,92,246,0.3)]";

// --- Components ---

export function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
    return <section id={id} className={`w-full max-w-7xl mx-auto px-6 md:px-8 relative z-10 ${className}`}>{children}</section>;
}

export function Badge({ children, className = "" }: { children: React.ReactNode, className?: string }) {
    return (
        <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs md:text-sm font-medium border border-white/10 bg-white/5 text-white/90 ${className}`}>
            <Sparkles className="w-3.5 h-3.5 text-yellow-400" /> {children}
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
            ? `${base} text-white/70 hover:text-white hover:bg-white/5 ${className}`
            : `${base} text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 ${className}`;

    const style = variant === "primary" ? { background: `linear-gradient(135deg, ${primary}, ${secondary})` } : {};

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
