'use client';

import React from 'react';
import { FaWhatsapp } from 'react-icons/fa6';

export function FloatingButtons() {
    const phoneNumber = '551151994714';
    const message = encodeURIComponent('Olá! Gostaria de saber mais sobre a Dialogy e seus planos.');
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

    return (
        <div className="fixed bottom-6 right-6 z-50">
            {/* WhatsApp Button */}
            <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/30 hover:scale-110 hover:shadow-[#25D366]/50 transition-all duration-300"
                title="Fale conosco no WhatsApp"
            >
                <FaWhatsapp className="w-7 h-7" />

                {/* Pulse animation */}
                <span className="absolute inset-0 rounded-full bg-[#25D366] animate-ping opacity-30" />

                {/* Tooltip */}
                <span className="absolute right-full mr-3 px-3 py-2 rounded-lg bg-black/90 text-white text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Fale conosco no WhatsApp
                </span>
            </a>
        </div>
    );
}
