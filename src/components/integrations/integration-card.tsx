

'use client';

import type { Integration } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import Link from 'next/link';

interface IntegrationCardProps {
  integration: Integration;
}

export function IntegrationCard({ integration }: IntegrationCardProps) {

  const getTagVariant = (tagType: Integration['tagType']) => {
    switch (tagType) {
      case 'primary': return 'default';
      case 'secondary': return 'secondary';
      case 'beta': return 'outline';
      default: return 'secondary';
    }
  }

  const CardContentWrapper = ({ children }: { children: React.ReactNode }) => {
    if (integration.href) {
        return <Link href={integration.href} className="flex flex-col flex-grow h-full">{children}</Link>;
    }
    return <>{children}</>;
  }


  return (
    <Card className="flex flex-col h-full hover:shadow-lg transition-shadow">
        <CardContentWrapper>
            <CardHeader className="flex-row items-start justify-between gap-4">
                <Avatar className="w-12 h-12 rounded-lg border">
                <AvatarImage src={integration.iconUrl} alt={integration.name} data-ai-hint="logo" />
                <AvatarFallback>{integration.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <Badge 
                variant={getTagVariant(integration.tagType)}
                className={cn({
                    'bg-secondary/80 border-transparent': integration.tagType === 'secondary',
                    'bg-transparent border-foreground/80': integration.tagType === 'beta',
                })}
                >
                {integration.tag}
                </Badge>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardTitle className="text-base font-bold flex items-center gap-1.5">
                {integration.status === 'active' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                {integration.name}
                </CardTitle>
                <CardDescription className="mt-1 text-xs leading-5">
                {integration.description}
                </CardDescription>
                {integration.additionalInfo && (
                    <p className="text-xs font-semibold text-blue-600 mt-1">{integration.additionalInfo}</p>
                )}
            </CardContent>
            <CardFooter>
                <Button variant="outline" size="sm" className="w-full" asChild={!!integration.href}>
                    {integration.href ? <Link href={integration.href}>Gerenciar</Link> : (integration.status === 'active' ? 'Gerenciar' : 'Habilitar')}
                </Button>
            </CardFooter>
        </CardContentWrapper>
    </Card>
  );
}
