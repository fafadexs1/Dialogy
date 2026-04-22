"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BentoGridShowcase } from "@/components/bento-product-features";
import {
  Settings2,
  Command,
  Plus,
  MessageSquare,
  Bot,
} from "lucide-react";

const OmnichannelCard = () => (
  <Card className="flex h-full flex-col border-white/10 bg-zinc-900/50 text-white">
    <CardHeader>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/20 text-brand-green">
        <MessageSquare className="h-6 w-6" />
      </div>
      <CardTitle className="text-xl">Inbox Unificado Omnichannel</CardTitle>
      <CardDescription className="text-white/60">
        Conecte a API Oficial do WhatsApp, Instagram e Messenger. Pare de perder vendas por falta de contexto e unifique toda a comunicação da sua empresa em uma única tela.
      </CardDescription>
    </CardHeader>
    <CardFooter className="mt-auto flex items-center justify-between">
      <Button variant="outline" size="sm" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
        <Settings2 className="mr-2 h-4 w-4" />
        Configurar Canais
      </Button>
      <Switch
        className="data-[state=checked]:bg-brand-green"
        aria-label="Toggle omnichannel"
        defaultChecked
      />
    </CardFooter>
  </Card>
);

const TeamsCard = () => (
  <Card className="h-full border-white/10 bg-zinc-900/50 text-white">
    <CardContent className="flex h-full flex-col justify-between p-6">
      <div>
        <CardTitle className="text-base font-medium">Filas e Departamentos</CardTitle>
        <CardDescription className="text-white/60">Roteamento para toda a equipe</CardDescription>
      </div>
      <div className="flex -space-x-2 overflow-hidden mt-4">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-zinc-900 bg-blue-500 text-xs font-bold text-white">V</div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-zinc-900 bg-emerald-500 text-xs font-bold text-white">S</div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-zinc-900 bg-amber-500 text-xs font-bold text-white">A</div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-zinc-900 bg-zinc-800 text-xs font-medium text-white/50">+5</div>
      </div>
    </CardContent>
  </Card>
);

const AnalyticsCard = () => (
  <Card className="h-full border-white/10 bg-zinc-900/50 text-white">
    <CardContent className="flex h-full flex-col justify-between p-6">
      <div className="flex items-start justify-between">
        <div>
          <CardTitle className="text-base font-medium">SLA de Resposta</CardTitle>
          <CardDescription className="text-white/60">Métricas em tempo real</CardDescription>
        </div>
        <Badge variant="outline" className="border-brand-green/30 text-brand-green bg-brand-green/10">
          Otimizado
        </Badge>
      </div>
      <div className="mt-4">
        <span className="text-5xl font-bold text-white">-42%</span>
      </div>
      <div className="flex justify-between text-xs text-white/50 mt-2">
        <span>Tempo de espera</span>
        <span>Média mensal</span>
      </div>
    </CardContent>
  </Card>
);

const ScaleCard = () => (
  <Card className="relative h-full w-full overflow-hidden border-white/10 bg-zinc-900/50 text-white">
    <div
      className="absolute inset-0 opacity-10"
      style={{
        backgroundImage: "radial-gradient(hsl(var(--foreground)) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    />
    <CardContent className="relative z-10 flex h-full items-center justify-center p-6">
      <div className="text-center">
        <span className="text-7xl font-extrabold text-white">10X</span>
        <p className="text-xs text-brand-green font-bold tracking-[0.2em] uppercase mt-2">Mais conversão</p>
      </div>
    </CardContent>
  </Card>
);

const AiCard = () => (
  <Card className="h-full border-white/10 bg-zinc-900/50 text-white relative overflow-hidden group">
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    <CardContent className="flex h-full flex-col justify-end p-6 relative z-10">
      <Bot className="h-8 w-8 text-indigo-400 mb-4" />
      <CardTitle className="text-base font-medium">Copiloto de IA</CardTitle>
      <CardDescription className="text-white/60 mt-1">
        Triagem automática, resumo de conversas e sugestões de respostas inteligentes.
      </CardDescription>
    </CardContent>
  </Card>
);

const AutomationCard = () => (
  <Card className="h-full border-white/10 bg-zinc-900/50 text-white">
    <CardContent className="flex h-full flex-wrap items-center justify-between gap-4 p-6">
      <div>
        <CardTitle className="text-base font-medium">Respostas Rápidas</CardTitle>
        <CardDescription className="text-white/60 mt-1">
          Acione templates aprovados pela Meta em segundos.
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-white/5 font-mono text-xs font-medium text-white/70">
          <Command className="h-4 w-4" />
        </div>
        <Plus className="h-3 w-3 text-white/40" />
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-white/5 font-mono text-xs font-medium text-white/70">
          K
        </div>
      </div>
    </CardContent>
  </Card>
);

export function DialogyBentoGrid() {
  return (
    <div className="w-full">
      <div className="mb-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-green mb-3">
          Visão Geral da Plataforma
        </p>
        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
          Chatbot para WhatsApp, Instagram e <br className="hidden md:block" /> atendimento omnichannel.
        </h2>
        <p className="mt-6 text-lg leading-8 text-white/60 max-w-2xl">
          Automatize conversas, mantenha contexto entre canais e entregue cada lead para a equipe certa no momento ideal.
        </p>
      </div>

      <BentoGridShowcase
        integration={<OmnichannelCard />}
        trackers={<TeamsCard />}
        statistic={<ScaleCard />}
        focus={<AnalyticsCard />}
        productivity={<AiCard />}
        shortcuts={<AutomationCard />}
      />
    </div>
  );
}
