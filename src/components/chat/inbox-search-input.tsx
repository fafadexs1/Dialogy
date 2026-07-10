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
      <div className={styles.main}>
          <input
            {...props}
            autoComplete={autoComplete}
            className={cn(styles.input, className)}
            onKeyDown={handleKeyDown}
            type={type}
          />
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
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="22" y1="22" x2="16.65" y2="16.65" />
            </svg>
          </div>
      </div>
    </div>
  );
}
