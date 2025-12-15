'use client';

import React, { useEffect } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import {
  ArrowRight, Check, Bot, MessagesSquare,
  BarChart3, Shield, Code2, Users, Globe,
  Terminal, Zap
} from "lucide-react";
import Link from "next/link";
import { getLandingStats } from "@/actions/landing";
import { PLANS } from "@/lib/plans";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import {
  Section, Badge, CTAButton, GradientOrb,
  primary, secondary, accent, glass
} from "@/components/landing/ui";

// --- Local Components (Page Specific) ---

function FeatureCard({ icon: Icon, title, description, delay = 0 }: { icon: any, title: string, description: string, delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className={`group relative p-8 rounded-3xl ${glass} overflow-hidden`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative z-10">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
        <p className="text-white/70 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}

function PricingCard({ plan, popular = false, delay = 0 }: { plan: any, popular?: boolean, delay?: number }) {
  const isEnterprise = plan.id === 'enterprise';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className={`relative p-8 rounded-3xl border ${popular ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/10 bg-white/5'} flex flex-col`}
    >
      {popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full text-xs font-bold text-white uppercase tracking-wider shadow-lg">
          Mais Popular
        </div>
      )}

      <div className="mb-8">
        <h3 className="text-xl font-bold text-white mb-2">{plan.label}</h3>
        <div className="flex items-baseline gap-1">
          {isEnterprise ? (
            <span className="text-3xl font-bold text-white">Sob Consulta</span>
          ) : (
            <>
              <span className="text-4xl font-bold text-white">R$ {plan.price}</span>
              <span className="text-white/60">/mês</span>
            </>
          )}
        </div>
      </div>

      <ul className="space-y-4 mb-8 flex-1">
        <li className="flex items-center gap-3 text-white/70">
          <Check className="w-5 h-5 text-green-500 shrink-0" />
          <span>{isEnterprise ? 'Usuários Sob Demanda' : `${plan.limits.users} Usuário${plan.limits.users > 1 ? 's' : ''}`}</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          <Check className="w-5 h-5 text-green-500 shrink-0" />
          <span>{isEnterprise ? 'WhatsApp Sob Demanda' : `${plan.limits.whatsapp} WhatsApp${plan.limits.whatsapp > 1 ? 's' : ''}`}</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          <Check className="w-5 h-5 text-green-500 shrink-0" />
          <span>{isEnterprise ? 'Histórico Sob Demanda' : `${plan.limits.history_months} Meses de Histórico`}</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          {plan.limits.departments ? <Check className="w-5 h-5 text-green-500 shrink-0" /> : <div className="w-5 h-5" />}
          <span className={plan.limits.departments ? '' : 'text-muted-foreground/50'}>Departamentos</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          {plan.limits.api ? <Check className="w-5 h-5 text-green-500 shrink-0" /> : <div className="w-5 h-5" />}
          <span className={plan.limits.api ? '' : 'text-muted-foreground/50'}>API de Desenvolvedor</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          {plan.limits.transcription ? <Check className="w-5 h-5 text-green-500 shrink-0" /> : <div className="w-5 h-5" />}
          <span className={plan.limits.transcription ? '' : 'text-muted-foreground/50'}>Transcrição de Áudio</span>
        </li>
        <li className="flex items-center gap-3 text-muted-foreground">
          {plan.limits.campaigns ? <Check className="w-5 h-5 text-green-500 shrink-0" /> : <div className="w-5 h-5" />}
          <span className={plan.limits.campaigns ? '' : 'text-muted-foreground/50'}>
            Disparos em Massa {typeof plan.limits.campaigns === 'string' ? `(${plan.limits.campaigns === 'high' ? 'CSV' : 'Contatos'})` : ''}
          </span>
        </li>
      </ul>

      <CTAButton href="/register" variant={popular ? 'primary' : 'outline'} className="w-full">
        {isEnterprise ? 'Falar com Vendas' : 'Começar Agora'}
      </CTAButton>
    </motion.div>
  );
}

function Stat({ value, label }: { value: string, label: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50 mb-2">
        {value}
      </div>
      <div className="text-sm text-white/60 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

// --- Main Page Component ---

export default function DialogyLanding() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const [stats, setStats] = React.useState({ messages: 0, workspaces: 0 });

  useEffect(() => {
    getLandingStats().then(data => {
      setStats(data);
    });
  }, []);

  return (
    <div className={`min-h-screen w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0f1729] via-[#020617] to-black selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden`}>

      {/* Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 origin-left z-50"
        style={{ scaleX }}
      />

      {/* Background Effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-25" />
        <GradientOrb className="w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] -top-[20%] -left-[10%] opacity-30" color="#4F46E5" /> {/* Indigo */}
        <GradientOrb className="w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] top-[10%] -right-[20%] opacity-20" color="#EC4899" /> {/* Pink */}
        <GradientOrb className="w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] bottom-[20%] left-[20%] opacity-20" color="#06B6D4" /> {/* Cyan */}
      </div>

      <Navbar />

      {/* Hero Section */}
      <header className="relative pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
        <Section className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <Badge className="mb-8">Novo: Dialogy AI Engine 2.0</Badge>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight text-white mb-8 leading-[1.1]">
              O Futuro da <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-white/90 to-rose-300 animate-gradient-x drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                IA Conversacional
              </span>
            </h1>

            <p className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed">
              Unifique todos os seus canais de atendimento em um único inbox inteligente.
              Automatize o suporte, impulsione vendas e encante usuários com a plataforma de chatbot mais avançada do mundo.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <CTAButton href="/register" className="w-full sm:w-auto text-lg px-8 py-4">
                Comece Grátis <ArrowRight className="w-5 h-5" />
              </CTAButton>
              <CTAButton href="/developer" variant="outline" className="w-full sm:w-auto text-lg px-8 py-4">
                <Terminal className="w-5 h-5" /> Documentação
              </CTAButton>
            </div>
          </motion.div>

          {/* Hero Dashboard Preview */}
          <motion.div
            initial={{ opacity: 0, y: 100, rotateX: 20 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 1, delay: 0.2, type: "spring" }}
            className="mt-20 relative mx-auto max-w-5xl perspective-1000"
          >
            <div className={`relative rounded-xl border border-white/10 bg-black/40 backdrop-blur-2xl p-2 shadow-2xl shadow-blue-500/10`}>
              <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              <div className="rounded-lg overflow-hidden bg-[#030712] aspect-[16/9] relative">
                {/* Mock UI */}
                <div className="absolute inset-0 flex">
                  <div className="w-64 border-r border-white/5 bg-white/5 p-4 hidden md:block">
                    <div className="space-y-3">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 p-6 flex flex-col">
                    <div className="h-16 border-b border-white/5 mb-6 flex items-center justify-between">
                      <div className="w-32 h-6 rounded bg-white/10" />
                      <div className="flex gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20" />
                        <div className="w-8 h-8 rounded-full bg-purple-500/20" />
                      </div>
                    </div>
                    <div className="flex-1 space-y-4">
                      <div className="flex justify-start"><div className="max-w-[70%] p-4 rounded-2xl rounded-tl-none bg-white/10 text-white/80 text-sm">Olá! Como posso ajudar você hoje?</div></div>
                      <div className="flex justify-end"><div className="max-w-[70%] p-4 rounded-2xl rounded-tr-none bg-blue-600 text-white text-sm">Preciso verificar o status do meu pedido.</div></div>
                      <div className="flex justify-start"><div className="max-w-[70%] p-4 rounded-2xl rounded-tl-none bg-white/10 text-white/80 text-sm">Claro, posso ajudar com isso. Qual é o número do pedido?</div></div>
                    </div>
                    <div className="mt-6 h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-4">
                      <div className="w-full h-2 rounded bg-white/10" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Glow behind dashboard */}
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-500 to-purple-600 blur-3xl opacity-20 -z-10 rounded-[3rem]" />
          </motion.div>
        </Section>
      </header>

      {/* Stats Section */}
      <Section className="py-20 border-y border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
          <Stat value={stats.messages > 0 ? stats.messages.toLocaleString() : "..."} label="Mensagens Processadas" />
          <Stat value="99.9%" label="SLA de Uptime" />
          <Stat value={stats.workspaces > 0 ? stats.workspaces.toLocaleString() : "..."} label="Empresas Confiando" />
        </div>
      </Section>

      {/* Features Grid */}
      <Section id="features" className="py-32">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Tudo o que você precisa para escalar</h2>
          <p className="text-lg text-white/70">
            Ferramentas poderosas projetadas para desenvolvedores, equipes de suporte e growth hackers.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={MessagesSquare}
            title="Inbox Unificado"
            description="Gerencie WhatsApp, Instagram, Messenger e Email em uma única interface em tempo real."
            delay={0.1}
          />
          <FeatureCard
            icon={Bot}
            title="Piloto Automático IA"
            description="Treine modelos de IA personalizados para responder 80% das perguntas automaticamente com precisão humana."
            delay={0.2}
          />
          <FeatureCard
            icon={Zap}
            title="Fluxos Instantâneos"
            description="Construtor arrasta-e-solta para criar fluxos de automação complexos sem escrever uma linha de código."
            delay={0.3}
          />
          <FeatureCard
            icon={BarChart3}
            title="Analytics Profundo"
            description="Insights em tempo real sobre desempenho da equipe, satisfação do cliente e tendências de conversa."
            delay={0.4}
          />
          <FeatureCard
            icon={Shield}
            title="Segurança Enterprise"
            description="Criptografia bancária, controle de acesso baseado em função e logs de auditoria completos."
            delay={0.5}
          />
          <FeatureCard
            icon={Globe}
            title="Infraestrutura Global"
            description="Servidores em edge garantem baixa latência e alta disponibilidade onde quer que seus clientes estejam."
            delay={0.6}
          />
        </div>
      </Section>

      {/* Pricing Section */}
      <Section id="pricing" className="py-32">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Planos que cabem no seu bolso</h2>
          <p className="text-lg text-muted-foreground">
            Comece grátis e escale conforme sua empresa cresce. Sem surpresas no fim do mês.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <PricingCard plan={PLANS.starter} delay={0.1} />
          <PricingCard plan={PLANS.pro} popular={true} delay={0.2} />
          <PricingCard plan={PLANS.business} delay={0.3} />
          <PricingCard plan={PLANS.enterprise} delay={0.4} />
        </div>
      </Section>

      {/* Developer Section */}
      <Section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-3xl" />
        <div className="relative z-10 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <Badge className="mb-6 bg-blue-500/10 border-blue-500/20 text-blue-400">
              <Code2 className="w-3 h-3 text-blue-400" /> Desenvolvedores Primeiro
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Feito para devs, <br /> por devs.
            </h2>
            <p className="text-lg text-white/60 mb-8 leading-relaxed">
              Nossa API foi projetada para ser intuitiva e poderosa. Integre o Dialogy à sua stack existente em minutos, não semanas.
              Confira nossa documentação abrangente e guias da comunidade.
            </p>
            <ul className="space-y-4 mb-10">
              {['APIs REST & GraphQL', 'Webhooks & Eventos', 'SDKs para Node, Python, Go', 'Plugins da Comunidade'].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-white/80">
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
            <CTAButton href="/developer">
              Explorar Documentação <ArrowRight className="w-4 h-4" />
            </CTAButton>
          </div>
          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur-2xl opacity-30 group-hover:opacity-50 transition-opacity" />
            <div className="relative rounded-xl bg-[#0f172a] border border-white/10 p-6 font-mono text-sm text-blue-300 overflow-hidden shadow-2xl">
              <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-4">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
                <span className="ml-2 text-xs text-white/30">api-example.ts</span>
              </div>
              <div className="space-y-1">
                <div className="text-purple-400">import <span className="text-white">{`{ Dialogy }`}</span> from <span className="text-green-400">'@dialogy/sdk'</span>;</div>
                <div className="h-2" />
                <div className="text-blue-400">const <span className="text-white">client</span> = <span className="text-purple-400">new</span> Dialogy({`{`}</div>
                <div className="pl-4 text-white">apiKey: <span className="text-green-400">process.env.DIALOGY_KEY</span></div>
                <div>{`});`}</div>
                <div className="h-2" />
                <div className="text-white/50">// Enviar uma mensagem</div>
                <div className="text-purple-400">await <span className="text-white">client.messages.send</span>({`{`}</div>
                <div className="pl-4 text-white">to: <span className="text-green-400">'+5511999999999'</span>,</div>
                <div className="pl-4 text-white">text: <span className="text-green-400">'Olá do Dialogy!'</span></div>
                <div>{`});`}</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* CTA Footer */}
      <Section className="py-32 text-center">
        <div className="relative rounded-3xl bg-gradient-to-b from-blue-900/20 to-transparent border border-white/10 p-12 md:p-24 overflow-hidden">
          <GradientOrb className="w-[600px] h-[600px] -top-1/2 left-1/2 -translate-x-1/2" color="#3b82f6" />

          <div className="relative z-10 max-w-3xl mx-auto">
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-8">Pronto para transformar sua comunicação?</h2>
            <p className="text-xl text-white/60 mb-10">
              Junte-se a milhares de empresas usando Dialogy para construir melhores relacionamentos com clientes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <CTAButton href="/register" className="w-full sm:w-auto text-lg px-10 py-5">
                Começar Agora
              </CTAButton>
              <CTAButton href="/creators" variant="outline" className="w-full sm:w-auto text-lg px-10 py-5">
                Conheça o Time
              </CTAButton>
            </div>
          </div>
        </div>
      </Section>

      <Footer />
    </div>
  );
}
