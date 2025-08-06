
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/lib/types';
import { agents } from '@/lib/mock-data'; // Usaremos para obter os dados estáticos do agente

// This hook uses Supabase's Realtime Presence feature for real-time online status.
export function useOnlineStatus(currentUser: User) {
  const supabase = createClient();
  const [onlineAgents, setOnlineAgents] = useState<User[]>([]);

  useEffect(() => {
    if (!currentUser?.id) return;

    // Um canal único para rastrear todos os agentes online
    const channel = supabase.channel('online-agents');

    // Função para atualizar a lista de agentes online com base no estado de presença
    const updateOnlineStatus = (presenceState: any) => {
        const uniqueUserIds = new Set<string>();
        const presenceUsers: User[] = [];

        for (const id in presenceState) {
            const presences = presenceState[id] as unknown as { user: User }[];
            presences.forEach(p => {
                if (p.user && !uniqueUserIds.has(p.user.id)) {
                    uniqueUserIds.add(p.user.id);
                    // Adiciona a propriedade 'online' para consistência
                    presenceUsers.push({ ...p.user, online: true });
                }
            });
        }
        setOnlineAgents(presenceUsers);
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        updateOnlineStatus(presenceState);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        // Para simplificar, ressincronizamos em vez de adicionar incrementalmente
        const presenceState = channel.presenceState();
        updateOnlineStatus(presenceState);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // Para simplificar, ressincronizamos em vez de remover incrementalmente
        const presenceState = channel.presenceState();
        updateOnlineStatus(presenceState);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Quando o usuário se conecta, ele rastreia seu próprio status
          await channel.track({ user: currentUser });
        }
      });

    // Limpa a inscrição e o rastreamento quando o componente desmonta
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  // Adicionamos currentUser como dependência para garantir que temos os dados do usuário
  }, [supabase, currentUser?.id]); 

  return onlineAgents;
}
