'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    MessageSquare,
    Instagram,
    Facebook,
    Mail,
    Globe,
    MessageCircle,
    Smartphone
} from 'lucide-react';
import { WhatsAppIcon, InstagramIcon, FacebookIcon } from '../landing/sections/ui/Icons';

export function LoginShowcase() {
    // Orbital icons configuration - reduced radii to fit container
    const orbits = [
        { icon: <WhatsAppIcon className="text-emerald-500" size={18} />, radius: 70, duration: 18, delay: 0 },
        { icon: <InstagramIcon className="text-pink-500" size={18} />, radius: 70, duration: 18, delay: 6 },
        { icon: <FacebookIcon className="text-blue-600" size={18} />, radius: 70, duration: 18, delay: 12 },
        { icon: <Mail className="text-blue-400" size={16} />, radius: 100, duration: 25, delay: 3 },
        { icon: <Globe className="text-indigo-400" size={16} />, radius: 100, duration: 25, delay: 11 },
        { icon: <MessageCircle className="text-[#20E401]" size={16} />, radius: 100, duration: 25, delay: 19 },
    ];

    return (
        <div className="hidden lg:flex flex-col items-center justify-center bg-white/5 backdrop-blur-3xl border-l border-white/10 relative overflow-hidden h-full rounded-r-[2.5rem]">
            {/* Soft background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#20E401]/10 blur-[120px] rounded-full pointer-events-none" />

            {/* Header Text */}
            <div className="text-center mb-6 z-10 px-8">
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-3xl font-bold text-white mb-3 bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-400"
                >
                    Omnichannel <span className="text-[#20E401]">em todo lugar</span>
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-gray-400 text-sm max-w-sm mx-auto leading-relaxed"
                >
                    Gerencie todas as suas conversas em um único lugar, de forma simples e inteligente.
                </motion.p>
            </div>

            {/* Orbital Visualization */}
            <div className="relative w-[240px] h-[240px] flex items-center justify-center mb-4">
                {/* Central Logo */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative z-20 w-20 h-20 rounded-full bg-black border border-[#20E401]/30 flex items-center justify-center p-3 shadow-[0_0_50px_rgba(32,228,1,0.2)]"
                >
                    <img src="/logo.png" alt="Dialogy" className="w-full h-auto object-contain" />
                    <div className="absolute inset-0 rounded-full border border-[#20E401]/20 animate-ping opacity-20" />
                </motion.div>

                {/* Orbit Rings */}
                <div className="absolute w-[140px] h-[140px] rounded-full border border-white/5" />
                <div className="absolute w-[200px] h-[200px] rounded-full border border-white/5" />

                {/* Orbiting Icons */}
                {orbits.map((orbit, index) => (
                    <motion.div
                        key={index}
                        className="absolute"
                        animate={{
                            rotate: 360,
                        }}
                        transition={{
                            duration: orbit.duration,
                            repeat: Infinity,
                            ease: "linear",
                            delay: -orbit.delay
                        }}
                        style={{
                            width: orbit.radius * 2,
                            height: orbit.radius * 2,
                        }}
                    >
                        <motion.div
                            className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 p-3 rounded-2xl bg-black/80 border border-white/10 shadow-2xl backdrop-blur-xl"
                            animate={{
                                rotate: -360,
                            }}
                            transition={{
                                duration: orbit.duration,
                                repeat: Infinity,
                                ease: "linear",
                                delay: -orbit.delay
                            }}
                        >
                            <div className="animate-pulse">
                                {orbit.icon}
                            </div>
                        </motion.div>
                    </motion.div>
                ))}

                {/* Counter-rotation for icons to keep them upright */}
                {orbits.map((orbit, index) => (
                    <motion.div
                        key={`counter-${index}`}
                        className="hidden" // Just logic, not visible
                    />
                ))}
            </div>

            {/* Footer Text */}
            <div className="text-center z-10 px-12">
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-sm text-gray-500 italic max-w-sm mx-auto"
                >
                    Compatível com WhatsApp, Instagram, Messenger, E-mail e muito mais para uma experiência fluida.
                </motion.p>

                {/* Dots Navigation Mockup */}
                <div className="flex gap-2 mt-4 justify-center">
                    <div className="w-8 h-1 bg-[#20E401] rounded-full" />
                    <div className="w-2 h-1 bg-white/10 rounded-full" />
                    <div className="w-2 h-1 bg-white/10 rounded-full" />
                </div>
            </div>
        </div>
    );
}
