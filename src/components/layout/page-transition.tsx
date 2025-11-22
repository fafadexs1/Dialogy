'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface PageTransitionProps {
  children: ReactNode;
  transitionKey?: string;
  className?: string;
}

export function PageTransition({
  children,
  transitionKey,
  className,
}: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={transitionKey}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className={`min-h-0 h-full w-full ${className ?? ''}`}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
