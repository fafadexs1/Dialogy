'use client';

import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Play, Check, Zap, Bot, MessagesSquare, BarChart3, Shield, Sparkles } from "lucide-react";

// Dialogy brand
const primary = "#2454d3";

const glow = "shadow-[0_0_40px_rgba(36,84,211,0.35)]";
const glass = "backdrop-blur-xl bg-white/8 border border-white/10";

const Section = ({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) => (
  <section id={id} className={`w-full max-w-7xl mx-auto px-5 md:px-8 ${className}`}>{children}</section>
);

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs md:text-sm border border-white/20 bg-white/5 text-white/80">
    <Sparkles className="w-3.5 h-3.5" /> {children}
  </span>
);

const CTAButton = ({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "outline" }) => {
  const base = "inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-medium transition-transform hover:scale-[1.02] active:scale-[0.98]";
  if (variant === "outline")
    return (
      <button className={`${base} border border-white/30 text-white/90 ${glow}`}>{children}</button>
    );
  return (
    <button className={`${base} text-white bg-[${primary}]`} style={{ background: `linear-gradient(90deg, ${primary}, #2d8cff)`}}>{children}</button>
  );
};

const GradientOrb = ({ className = "" }: { className?: string }) => (
  <div
    aria-hidden
    className={`pointer-events-none absolute rounded-full blur-3xl opacity-30 ${className}`}
    style={{ background: `radial-gradient(closest-side, ${primary}, transparent)` }}
  />
);

const ChannelIcon = ({ name }: { name: string }) => {
  const size = 22;
  const common = "w-5 h-5";
  switch (name) {
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-label="WhatsApp"><path fill="#25D366" d="M20.52 3.48A11.94 11.94 0 0012 0C5.37 0 0 5.37 0 12s5.37 12 12 12c2.06 0 4.02-.52 5.76-1.44l.36-.2-.78-4.56-.2-.12a9.54 9.54 0 01-5.14 1.5C6.26 19.18 2.82 15.74 2.82 12S6.26 4.82 12 4.82 21.18 8.26 21.18 12c0 1.8-.5 3.48-1.36 4.92l2.12 2.12A11.94 11.94 0 0024 12c0-3.19-1.24-6.19-3.48-8.52z"/></svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-label="Instagram"><defs><linearGradient id="ig" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="#f58529"/><stop offset="50%" stopColor="#dd2a7b"/><stop offset="100%" stopColor="#8134af"/></linearGradient></defs><rect width="18" height="18" rx="5" x="3" y="3" fill="url(#ig)"/><circle cx="12" cy="12" r="3.8" fill="#fff"/><circle cx="17.2" cy="6.8" r="1.2" fill="#fff"/></svg>
      );
    case "messenger":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-label="Messenger"><path fill="#2d8cff" d="M12 0C5.37 0 0 4.98 0 11.12c0 3.37 1.7 6.39 4.43 8.37v4.5l4.05-2.22c1.08.3 2.24.47 3.43.47 6.63 0 12-4.98 12-11.12S18.63 0 12 0zm1.1 14.94l-2.92-3.11-5.6 3.11 6.16-6.6 2.93 3.1 5.6-3.1-6.17 6.6z"/></svg>
      );
    case "ifood":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-label="iFood"><path fill="#e02020" d="M3 10c.8-.2 1.7-.4 2.7-.4 1.6 0 2.3.6 2.3 1.7v4.5H6.3V12c0-.7-.4-1-1.2-1-.3 0-.6 0-.9.1V10zm11.8 5.8c-.7.4-1.6.6-2.6.6-2.4 0-4.1-1.4-4.1-3.7 0-2.2 1.7-3.6 4.2-3.6 1 0 1.8.2 2.5.5l-.5 1.7c-.6-.2-1.1-.3-1.8-.3-1.3 0-2.2.8-2.2 2 0 1.3.9 2 2.2 2 .7 0 1.3-.1 1.9-.4l.4 1.2zm6.8-2.9h-2.2l-.4 1.3h-1.9l2.6-6.6h1.8l2.6 6.6h-1.9l-.6-1.3zM4.7 8.8h1.6L5 12.9H3.4l1.3-4.1z"/></svg>
      );
    default:
      return <div style={{ width: size, height: size }} />;
  }
};

const Feature = ({ icon: Icon, title, children }: { icon: React.ElementType, title: string, children: React.ReactNode }) => (
  <div className={`relative rounded-2xl p-5 md:p-6 ${glass} ${glow}`}>
    <div className="flex items-center gap-3 mb-3">
      <div className="p-2 rounded-xl bg-white/10 border border-white/20">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <h3 className="text-white text-lg font-semibold">{title}</h3>
    </div>
    <p className="text-white/80 leading-relaxed text-sm md:text-base">{children}</p>
  </div>
);

const Price = ({ tier, price, features, highlight }: { tier: string, price: string, features: string[], highlight?: boolean }) => (
  <div className={`rounded-3xl p-6 md:p-8 ${glass} ${glow} ${highlight ? "ring-2 ring-white/40" : ""}`}>
    <div className="flex items-baseline justify-between">
      <h4 className="text-white text-xl font-semibold">{tier}</h4>
      {highlight && <Badge>Mais popular</Badge>}
    </div>
    <div className="mt-4 flex items-end gap-2">
      <span className="text-white text-4xl md:text-5xl font-bold">{price}</span>
      <span className="text-white/60">/mês</span>
    </div>
    <ul className="mt-6 space-y-3">
      {features.map((f, i) => (
        <li key={i} className="flex items-start gap-3 text-white/85">
          <Check className="w-5 h-5 mt-0.5" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    <div className="mt-8">
      <CTAButton>{highlight ? "Começar agora" : "Experimentar"} <ArrowRight className="w-4 h-4"/></CTAButton>
    </div>
  </div>
);

export default function DialogyLanding() {
  return (
    <div className="min-h-screen w-full bg-[#0b132b] selection:bg-white/20 selection:text-white">
      {/* Background layers */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{
          background: `radial-gradient(1200px 600px at 10% -10%, ${primary}22, transparent), radial-gradient(1000px 500px at 90% 20%, #2d8cff22, transparent), linear-gradient(180deg, #0b132b 0%, #0b132b 30%, #0f1a3a 100%)`
        }} />
        <GradientOrb className="w-[42rem] h-[42rem] -top-40 -left-20" />
        <GradientOrb className="w-[36rem] h-[36rem] top-20 right-[-10rem]" />
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-30 backdrop-blur-xl/2 bg-[#0b132b]/30 border-b border-white/10">
        <Section className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl" style={{background: `conic-gradient(from 180deg, ${primary}, #2d8cff)`}} />
            <div className="text-white font-semibold tracking-tight text-lg">Dialogy</div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-white/80">
            <a className="hover:text-white" href="#produto">Produto</a>
            <a className="hover:text-white" href="#integracoes">Integrações</a>
            <a className="hover:text-white" href="#precos">Preços</a>
            <a className="hover:text-white" href="#suporte">Suporte</a>
          </div>
          <div className="flex items-center gap-3">
            <CTAButton variant="outline">Entrar</CTAButton>
            <CTAButton>Comece grátis <ArrowRight className="w-4 h-4"/></CTAButton>
          </div>
        </Section>
      </nav>

      {/* Hero */}
      <header className="relative overflow-hidden">
        <Section className="py-16 md:py-28 text-center">
          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{duration:0.6}}>
            <div className="flex justify-center">
              <Badge>Omnichannel + IA</Badge>
            </div>
            <h1 className="mt-6 text-4xl md:text-6xl font-bold tracking-tight text-white leading-[1.05] max-w-4xl mx-auto">
              Todas as suas <span className="text-transparent bg-clip-text" style={{backgroundImage:`linear-gradient(90deg, ${primary}, #2d8cff)`}}>conversas</span>,
              em um só lugar.
            </h1>
            <p className="mt-5 text-white/70 max-w-2xl mx-auto text-lg">
              Centralize WhatsApp, Instagram, Messenger, iFood e muito mais — com IA, automações e equipe conectada.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <CTAButton>Comece grátis <ArrowRight className="w-4 h-4"/></CTAButton>
              <CTAButton variant="outline"><Play className="w-4 h-4"/> Ver demonstração</CTAButton>
            </div>
          </motion.div>

          {/* Floating channel nodes */}
          <div className="relative mt-14 max-w-3xl mx-auto">
            <div className={`rounded-3xl ${glass} ${glow} p-5 md:p-8`}> 
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 place-items-center">
                {[["whatsapp","WhatsApp"],["instagram","Instagram"],["messenger","Messenger"],["ifood","iFood"]].map(([k, label]) => (
                  <div key={k} className="flex items-center gap-2 text-white/90">
                    <ChannelIcon name={k} />
                    <span className="text-sm">{label as string}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </header>

      {/* Logos */}
      <Section className="py-10 md:py-14 opacity-90">
        <div className={`rounded-2xl ${glass} p-4 md:p-6`}>
          <p className="text-center text-white/60 text-sm">Empresas que confiam na Dialogy</p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-6 md:gap-10 items-center opacity-80">
            {["Velpro","CacauShow","Senac","Rappi","iFood","OiFibra"].map((n)=> (
              <div key={n} className="h-8 md:h-10 bg-white/10 rounded-lg border border-white/10" />
            ))}
          </div>
        </div>
      </Section>

      {/* Produto */}
      <Section id="produto" className="py-20">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2">
              <Badge>Painel Omnichannel</Badge>
            </div>
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-white">Gestão unificada de conversas</h2>
            <p className="mt-4 text-white/70 leading-relaxed">
              Veja todos os canais em um só lugar. Atribua atendimentos, crie SLAs, use respostas rápidas e automações com IA para nunca deixar um cliente sem retorno.
            </p>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Feature icon={MessagesSquare} title="Inbox Unificado">
                Centralize WhatsApp, Instagram, Messenger, iFood, e-mail e mais.
              </Feature>
              <Feature icon={Bot} title="Automação com IA">
                Fluxos com NLP, FAQs inteligentes e triagem automática 24/7.
              </Feature>
              <Feature icon={BarChart3} title="Relatórios em Tempo Real">
                Acompanhe tempo de resposta, NPS, CSAT e produtividade.
              </Feature>
              <Feature icon={Shield} title="Permissões & Segurança">
                Perfis de acesso, auditoria e LGPD by design.
              </Feature>
            </div>
          </div>
          <div>
            <div className={`relative rounded-3xl ${glass} ${glow} p-4 md:p-6 overflow-hidden`}> 
              <div className="aspect-[16/10] rounded-2xl bg-[#0f1a3a] border border-white/10 p-4 flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400/60"/>
                  <div className="w-2 h-2 rounded-full bg-yellow-400/60"/>
                  <div className="w-2 h-2 rounded-full bg-green-400/60"/>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-3 flex-1">
                  <aside className="col-span-1 space-y-2">
                    {["Todos","WhatsApp","Instagram","Messenger","iFood"].map((t,i)=> (
                      <div key={t} className={`rounded-xl px-3 py-2 text-sm ${i===0?"bg-white/10 text-white":"text-white/70 hover:bg-white/5"}`}>{t}</div>
                    ))}
                  </aside>
                  <main className="col-span-4 grid grid-rows-6 gap-2">
                    {[...Array(6)].map((_,i)=> (
                      <div key={i} className="rounded-xl bg-white/5 border border-white/10 h-full" />
                    ))}
                  </main>
                </div>
              </div>
              <GradientOrb className="w-80 h-80 -bottom-20 -right-10" />
            </div>
          </div>
        </div>
      </Section>

      {/* Integrações */}
      <Section id="integracoes" className="py-20">
        <div className="text-center max-w-3xl mx-auto">
          <Badge>Plug & Play</Badge>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold text-white">Integrações que destravam escala</h2>
          <p className="mt-3 text-white/70">Conecte seus canais e apps favoritos em minutos, não em semanas.</p>
        </div>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {["whatsapp","instagram","messenger","ifood","telegram","email"].map((k) => (
            <div key={k} className={`flex items-center justify-center gap-2 rounded-2xl p-4 ${glass} hover:bg-white/10 transition-colors`}>
              <ChannelIcon name={k} />
              <span className="text-white/85 capitalize text-sm">{k}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Métricas */}
      <Section className="py-20">
        <div className={`rounded-3xl ${glass} ${glow} p-6 md:p-10`}>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            {[{k:"+42%", l:"Velocidade de resposta"},{k:"-37%", l:"Custo por atendimento"},{k:"+61%", l:"Satisfação do cliente"}].map(({k,l})=> (
              <div key={l}>
                <div className="text-4xl md:text-5xl font-bold text-white">{k}</div>
                <div className="text-white/70 mt-2">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Preços */}
      <Section id="precos" className="py-20">
        <div className="text-center max-w-3xl mx-auto">
          <Badge>Transparente & sem pegadinhas</Badge>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold text-white">Planos para qualquer fase</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-6">
          <Price tier="Starter" price="R$ 0" features={["1 canal conectado","Até 2 agentes","Inbox unificado básico","Templates de respostas"]}/>
          <Price tier="Pro" price="R$ 149" highlight features={["Até 5 canais","Times & permissões","Automação com IA","Relatórios e SLA"]}/>
          <Price tier="Enterprise" price="Fale com vendas" features={["Canais ilimitados","SSO & auditoria","SLA dedicado","Integrações avançadas"]}/>
        </div>
      </Section>

      {/* CTA final */}
      <Section className="py-24 text-center">
        <div className={`rounded-3xl ${glass} ${glow} p-10 md:p-14 relative overflow-hidden`}>
          <GradientOrb className="w-[30rem] h-[30rem] -top-20 left-10" />
          <GradientOrb className="w-[26rem] h-[26rem] bottom-0 right-0" />
          <h2 className="text-3xl md:text-4xl font-bold text-white">Pronto para transformar sua comunicação?</h2>
          <p className="mt-3 text-white/75 max-w-2xl mx-auto">Comece em minutos. Conecte seus canais e atenda clientes onde eles estiverem.</p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <CTAButton>Iniciar com Dialogy <ArrowRight className="w-4 h-4"/></CTAButton>
            <CTAButton variant="outline">Falar com vendas</CTAButton>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer id="suporte" className="border-t border-white/10">
        <Section className="py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg" style={{background: `conic-gradient(from 180deg, ${primary}, #2d8cff)`}} />
            <span className="text-white/80">© {new Date().getFullYear()} Dialogy</span>
          </div>
          <div className="flex items-center gap-6 text-white/70">
            <a className="hover:text-white" href="#">Privacidade</a>
            <a className="hover:text-white" href="#">Termos</a>
            <a className="hover:text-white" href="#">Status</a>
            <a className="hover:text-white" href="#">Ajuda</a>
          </div>
        </Section>
      </footer>
    </div>
  );
}
