"use client";

import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface SectionRevealProps {
    children: React.ReactNode;
    className?: string;
    delay?: number;
}

const SectionReveal: React.FC<SectionRevealProps> = ({ children, className = "", delay = 0 }) => {
    const ref = useRef(null);
    const isInView = useInView(ref, {
        once: true,
        margin: "0px 0px -100px 0px" // Triggers when element is 100px from bottom
    });

    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
            animate={isInView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 40, filter: 'blur(10px)' }}
            transition={{
                duration: 0.8,
                ease: [0.25, 0.4, 0.25, 1], // Cubic bezier for "luxurious" feel
                delay: delay
            }}
            className={className}
        >
            {children}
        </motion.div>
    );
};

export default SectionReveal;
