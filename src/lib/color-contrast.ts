/**
 * Contraste de texto sobre cores definidas pelo usuário (etiquetas, equipes).
 *
 * A verificação anterior espalhada pela interface era
 * `cor.toLowerCase().startsWith('#fff')`. Qualquer tom claro que não começasse
 * literalmente com `#fff` — `#f5f5f5`, `#FFEB3B`, `#e0e0e0` — recebia texto
 * branco e sumia no fundo. E, quando a equipe não tinha cor gravada (o caso
 * padrão: a criação de equipe nunca grava `color`), o fundo caía para
 * `rgba(255,255,255,0.1)` com texto `#fff`: branco sobre branco no tema claro.
 */

import type { CSSProperties } from 'react';

type Rgb = { r: number; g: number; b: number };

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_FULL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const RGB_FUNCTIONAL = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

function parseAlpha(raw: string | undefined): number {
    if (raw === undefined) return 1;
    if (raw.endsWith('%')) {
        const percent = Number.parseFloat(raw.slice(0, -1));
        return Number.isFinite(percent) ? percent / 100 : 1;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 1;
}

/** Devolve o RGB apenas quando a cor é opaca o bastante para servir de fundo. */
export function parseSolidColor(value?: string | null): Rgb | null {
    if (typeof value !== 'string') return null;
    const color = value.trim();
    if (!color) return null;

    const short = HEX_SHORT.exec(color);
    if (short) {
        return {
            r: Number.parseInt(short[1] + short[1], 16),
            g: Number.parseInt(short[2] + short[2], 16),
            b: Number.parseInt(short[3] + short[3], 16),
        };
    }

    const full = HEX_FULL.exec(color);
    if (full) {
        const alpha = full[4] === undefined ? 1 : Number.parseInt(full[4], 16) / 255;
        if (alpha < 0.5) return null;
        return {
            r: Number.parseInt(full[1], 16),
            g: Number.parseInt(full[2], 16),
            b: Number.parseInt(full[3], 16),
        };
    }

    const functional = RGB_FUNCTIONAL.exec(color);
    if (functional) {
        if (parseAlpha(functional[4]) < 0.5) return null;
        return {
            r: Number.parseFloat(functional[1]),
            g: Number.parseFloat(functional[2]),
            b: Number.parseFloat(functional[3]),
        };
    }

    return null;
}

/** `true` quando a cor pode ser usada como fundo sólido de um chip. */
export function isUsableBadgeColor(value?: string | null): boolean {
    return parseSolidColor(value) !== null;
}

function channelLuminance(channel: number): number {
    const normalized = Math.min(255, Math.max(0, channel)) / 255;
    return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** Luminância relativa (WCAG 2.1), de 0 (preto) a 1 (branco). */
export function relativeLuminance(color: Rgb): number {
    return (
        0.2126 * channelLuminance(color.r) +
        0.7152 * channelLuminance(color.g) +
        0.0722 * channelLuminance(color.b)
    );
}

const DARK_TEXT = '#0f172a';
const LIGHT_TEXT = '#ffffff';

/**
 * Escolhe entre texto claro e escuro pela razão de contraste real com o fundo,
 * em vez de adivinhar pelo prefixo da string.
 */
export function readableTextColor(background?: string | null): string {
    const parsed = parseSolidColor(background);
    if (!parsed) return DARK_TEXT;

    const luminance = relativeLuminance(parsed);
    const contrastWithLight = 1.05 / (luminance + 0.05);
    const contrastWithDark =
        (luminance + 0.05) / (relativeLuminance({ r: 15, g: 23, b: 42 }) + 0.05);

    return contrastWithDark >= contrastWithLight ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * Estilo completo de um chip colorido, ou `null` quando não há cor utilizável —
 * nesse caso o chamador deve usar a classe neutra do tema, que funciona nos dois
 * modos, em vez de forçar branco sobre branco.
 */
export function badgeColorStyle(background?: string | null): CSSProperties | null {
    if (!isUsableBadgeColor(background)) return null;
    const color = readableTextColor(background);
    return {
        backgroundColor: background as string,
        color,
        borderColor: background as string,
    };
}
