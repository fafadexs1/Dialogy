'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    TrendingUp,
    Zap,
    BarChart3,
    Users,
    Target,
    Rocket,
    CheckCircle2
} from 'lucide-react';

export function RegisterShowcase() {
    // Orbital icons configuration - growth and scale theme
    const orbits = [
        { icon: <TrendingUp className="text-[#20E401]" size={18} />, radius: 70, duration: 20, delay: 0 },
        { icon: <Zap className="text-yellow-400" size={18} />, radius: 70, duration: 20, delay: 6.6 },
        { icon: <Target className="text-red-400" size={18} />, radius: 70, duration: 20, delay: 13.3 },
        { icon: <Users className="text-blue-400" size={16} />, radius: 100, duration: 28, delay: 4 },
        { icon: <BarChart3 className="text-purple-400" size={16} />, radius: 100, duration: 28, delay: 14 },
        { icon: <Rocket className="text-orange-400" size={16} />, radius: 100, duration: 28, delay: 24 },
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
                    Escala sem <span className="text-[#20E401]">Limites</span>
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-gray-400 text-sm max-w-sm mx-auto leading-relaxed"
                >
                    Automatize seu atendimento e veja sua operação crescer enquanto você foca no que importa.
                </motion.p>
            </div>

            {/* Orbital Visualization */}
            <div className="relative w-[240px] h-[240px] flex items-center justify-center mb-4">
                {/* Central Growth Indicator */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative z-20 w-20 h-20 rounded-full bg-black border border-[#20E401]/30 flex items-center justify-center p-3 shadow-[0_0_50px_rgba(32,228,1,0.2)]"
                >
                    <div className="relative">
                        <TrendingUp size={32} className="text-[#20E401]" />
                        <motion.div
                            animate={{ opacity: [0, 1, 0], scale: [1, 1.2, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute -top-1 -right-1 w-3 h-3 bg-[#20E401] rounded-full blur-[2px]"
                        />
                    </div>
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
                            <div className="hover:scale-110 transition-transform">
                                {orbit.icon}
                            </div>
                        </motion.div>
                    </motion.div>
                ))}
            </div>

            {/* Benefits List */}
            <div className="z-10 px-10 space-y-3">
                {[
                    "Automação inteligente 24/7",
                    "Dashboard de métricas avançadas",
                    "Integração com múltiplos canais"
                ].map((benefit, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 + (i * 0.1) }}
                        className="flex items-center gap-3 text-xs text-gray-400"
                    >
                        <div className="w-4 h-4 rounded-full bg-[#20E401]/10 flex items-center justify-center flex-shrink-0">
                            <CheckCircle2 size={10} className="text-[#20E401]" />
                        </div>
                        {benefit}
                    </motion.div>
                ))}
            </div>

            {/* Progress indicator mockup */}
            <div className="flex gap-2 mt-8 justify-center">
                <div className="w-2 h-1 bg-white/10 rounded-full" />
                <div className="w-8 h-1 bg-[#20E401] rounded-full" />
                <div className="w-2 h-1 bg-white/10 rounded-full" />
            </div>
        </div>
    );
}
