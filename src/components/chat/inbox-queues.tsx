'use client';

import type { LucideIcon } from 'lucide-react';
import { formatInboxCount } from '@/lib/inbox-pagination';

type QueueId = 'robo' | 'gerais' | 'atendimentos' | 'encerrados';

/** Stable, fully labelled queue navigation. Counts retain their loaded/total meaning. */
export function InboxQueues({ tabs, activeTab, loadedCounts, totalCounts, onSelect }: {
  tabs: readonly { id: QueueId; label: string; icon: LucideIcon }[];
  activeTab: QueueId;
  loadedCounts: Record<QueueId, number>;
  totalCounts: Record<QueueId, number>;
  onSelect: (id: QueueId) => void;
}) {
  return (
    <div className="inbox-queues" role="tablist" aria-label="Status das conversas">
      {tabs.map(({ id, label, icon: Icon }, index) => {
        const loaded = loadedCounts[id];
        const total = totalCounts[id];
        const description = loaded === total
          ? `${loaded.toLocaleString('pt-BR')} conversas carregadas`
          : `${loaded.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} conversas carregadas`;
        return (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id}
            aria-label={`${label}: ${description}`} title={description}
            tabIndex={activeTab === id ? 0 : -1} data-queue={id}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => {
              const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
              const delta = event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2
                : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : delta ? (index + delta + tabs.length) % tabs.length : -1;
              if (next < 0) return;
              event.preventDefault();
              onSelect(tabs[next].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>
            <span className="inbox-queue-icon"><Icon size={16} strokeWidth={1.7} aria-hidden="true" /></span>
            <span className="inbox-queue-label">{label}</span>
            <span className="inbox-queue-count">{formatInboxCount(loaded)}</span>
          </button>
        );
      })}
    </div>
  );
}
