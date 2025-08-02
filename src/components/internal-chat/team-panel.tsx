'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type User } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { agents as allAgents } from '@/lib/mock-data';

export default function TeamPanel() {
  const onlineAgents = useOnlineStatus();
  const onlineAgentIds = new Set(onlineAgents.map(a => a.id));

  const members = allAgents.map(agent => ({
    ...agent,
    online: onlineAgentIds.has(agent.id)
  }));


  return (
    <div className="hidden w-full max-w-xs flex-col border-l bg-card lg:flex">
      <div className="flex h-16 items-center border-b px-4">
        <h3 className="font-semibold">Membros ({members.length})</h3>
      </div>
      <ScrollArea>
        <div className="p-4 space-y-4">
            {members.map(member => (
                <div key={member.id} className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 relative">
                        <AvatarImage src={member.avatar} alt={member.name} data-ai-hint="person"/>
                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                        {member.online && <div className="absolute bottom-0 right-0 h-2.5 w-2.5 bg-green-500 rounded-full border-2 border-card" />}
                    </Avatar>
                    <div className="flex-1">
                        <p className="font-medium text-sm">{member.name}</p>
                        <p className="text-xs text-muted-foreground">{member.online ? 'Online' : 'Offline'}</p>
                    </div>
                </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
