'use client';

import React from 'react';
import { FaWhatsapp } from 'react-icons/fa6';

export function FloatingButtons() {
    const phoneNumber = '551151994714';
    const message = encodeURIComponent('Ola! Gostaria de saber mais sobre a Dialogy e seus planos.');
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

    return (
        <div className="fixed bottom-6 right-6 z-50">
            <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/30 transition-all duration-300 hover:scale-110 hover:shadow-[#25D366]/50"
                title="Fale conosco no WhatsApp"
                aria-label="Fale conosco no WhatsApp"
            >
                <FaWhatsapp className="h-7 w-7" />
                <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-30 animate-ping" />
                <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Fale conosco no WhatsApp
                </span>
            </a>
        </div>
    );
}
