'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import styles from './inbox-search-input.module.css';

type InboxSearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  containerClassName?: string;
  onEnter?: () => void;
  renderFilterTrigger?: (className: string) => React.ReactNode;
};

export function InboxSearchInput({
  containerClassName,
  className,
  onEnter,
  onKeyDown,
  renderFilterTrigger,
  type = 'text',
  autoComplete = 'off',
  ...props
}: InboxSearchInputProps) {
  const gradientIdBase = React.useId().replace(/:/g, '');
  const ringGradientId = `${gradientIdBase}-ring`;
  const lineGradientId = `${gradientIdBase}-line`;

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);

      if (!event.defaultPrevented && event.key === 'Enter' && onEnter) {
        event.preventDefault();
        event.stopPropagation();
        onEnter?.();
      }
    },
    [onEnter, onKeyDown]
  );

  return (
    <div className={cn(styles.wrapper, containerClassName)}>
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.frame}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.darkBorderBg} aria-hidden="true" />
        <div className={styles.darkBorderBg} aria-hidden="true" />
        <div className={styles.darkBorderBg} aria-hidden="true" />
        <div className={styles.white} aria-hidden="true" />
        <div className={styles.border} aria-hidden="true" />

        <div className={styles.main}>
          <input
            {...props}
            autoComplete={autoComplete}
            className={cn(styles.input, className)}
            onKeyDown={handleKeyDown}
            type={type}
          />
          <div className={styles.inputMask} aria-hidden="true" />
          <div className={styles.pinkMask} aria-hidden="true" />
          <div className={styles.filterBorder} aria-hidden="true" />
          <div className={styles.filterSlot}>
            {renderFilterTrigger?.(styles.filterTrigger)}
          </div>

          <div className={styles.searchIcon} aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle stroke={`url(#${ringGradientId})`} cx="11" cy="11" r="8" />
              <line stroke={`url(#${lineGradientId})`} x1="22" y1="22" x2="16.65" y2="16.65" />
              <defs>
                <linearGradient id={ringGradientId} gradientTransform="rotate(50)">
                  <stop offset="0%" stopColor="#f8e7f8" />
                  <stop offset="50%" stopColor="#b6a9b7" />
                </linearGradient>
                <linearGradient id={lineGradientId}>
                  <stop offset="0%" stopColor="#b6a9b7" />
                  <stop offset="50%" stopColor="#837484" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
