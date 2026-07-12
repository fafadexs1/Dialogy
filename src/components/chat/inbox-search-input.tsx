'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

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
            <Search className="h-5 w-5" />
          </div>
      </div>
    </div>
  );
}
