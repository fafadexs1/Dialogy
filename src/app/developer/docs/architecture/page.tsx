import Link from "next/link";
import { ArrowLeft, Layers, Database, Zap, Globe, Cpu, Lock } from "lucide-react";

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/developer/docs/architecture' });
}

export default function ArchitectureDocs() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <StoredSeoJsonLd pathname="/developer/docs/architecture" />
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <DeveloperBrand />
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer/docs" className="text-sm font-medium text-white/60 hover:text-white flex items-center gap-2">
                            <ArrowLeft className="w-4 h-4" /> Voltar para Docs
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="max-w-4xl mx-auto px-6 py-12">
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium mb-6">
                        <Layers className="w-3 h-3" /> Deep Dive
                    </div>
                    <h1 className="text-4xl font-bold mb-6">Arquitetura da Plataforma</h1>
                    <p className="text-xl text-white/60 leading-relaxed">
                        Uma visão técnica de como o Dialogy processa milhões de mensagens com baixa latência, segurança e escalabilidade.
                    </p>
                </div>

                <div className="prose prose-invert max-w-none">

                    <div className="grid md:grid-cols-2 gap-6 mb-12">
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                                <Globe className="w-5 h-5 text-blue-400" /> Frontend & Edge
                            </h3>
                            <p className="text-white/60 text-sm leading-relaxed">
                                Construído com <strong>Next.js 14</strong> (App Router), nossa interface é renderizada no servidor para performance máxima e SEO, com componentes Client-Side interativos para a experiência de chat em tempo real.
                            </p>
                        </div>
                        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                                <Database className="w-5 h-5 text-green-400" /> Backend & Data
                            </h3>
                            <p className="text-white/60 text-sm leading-relaxed">
                                Utilizamos <strong>Supabase (PostgreSQL)</strong> como fonte da verdade. O banco de dados não apenas armazena mensagens, mas atua como um hub de eventos em tempo real via <em>Replication Logs</em>.
                            </p>
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-6">Fluxo de Mensagens em Tempo Real</h2>
                    <div className="relative pl-8 border-l-2 border-white/10 space-y-8 mb-12">
                        <div className="relative">
                            <span className="absolute -left-[41px] top-0 w-5 h-5 rounded-full bg-blue-600 border-4 border-[#030712]" />
                            <h4 className="font-bold text-white mb-2">1. Ingestão (Webhooks)</h4>
                            <p className="text-white/60 text-sm">
                                Mensagens do WhatsApp (via Evolution API) ou Instagram chegam aos nossos endpoints de API Routes. Elas são validadas e normalizadas instantaneamente.
                            </p>
                        </div>
                        <div className="relative">
                            <span className="absolute -left-[41px] top-0 w-5 h-5 rounded-full bg-purple-600 border-4 border-[#030712]" />
                            <h4 className="font-bold text-white mb-2">2. Persistência & Trigger</h4>
                            <p className="text-white/60 text-sm">
                                A mensagem é salva no PostgreSQL. Isso dispara automaticamente um evento no canal <strong>Supabase Realtime</strong>.
                            </p>
                        </div>
                        <div className="relative">
                            <span className="absolute -left-[41px] top-0 w-5 h-5 rounded-full bg-green-600 border-4 border-[#030712]" />
                            <h4 className="font-bold text-white mb-2">3. Entrega ao Cliente</h4>
                            <p className="text-white/60 text-sm">
                                Os navegadores dos agentes, conectados via WebSockets, recebem o payload da nova mensagem em milissegundos e atualizam a UI sem refresh.
                            </p>
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-6">Segurança e Controle</h2>
                    <div className="grid gap-4 mb-8">
                        <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5">
                            <Lock className="w-6 h-6 text-red-400 mt-1" />
                            <div>
                                <h4 className="font-bold text-white">Row Level Security (RLS)</h4>
                                <p className="text-white/60 text-sm">
                                    Cada query ao banco de dados passa por políticas rigorosas de RLS. Um agente só pode ler dados do workspace ao qual pertence. O isolamento de dados é garantido no nível do banco.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5">
                            <Cpu className="w-6 h-6 text-orange-400 mt-1" />
                            <div>
                                <h4 className="font-bold text-white">Server Actions</h4>
                                <p className="text-white/60 text-sm">
                                    Operações sensíveis (como transferir chats ou alterar configurações) são executadas exclusivamente no servidor via Next.js Server Actions, prevenindo manipulação de cliente.
                                </p>
                            </div>
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-4">Integrações</h2>
                    <p className="text-white/60 mb-6">
                        Nossa arquitetura é agnóstica ao canal. Atualmente suportamos:
                    </p>
                    <ul className="grid grid-cols-2 gap-4 text-sm text-white/70">
                        <li className="flex items-center gap-2 bg-white/5 p-3 rounded-lg"><Zap className="w-4 h-4 text-green-400" /> WhatsApp (Evolution API)</li>
                        <li className="flex items-center gap-2 bg-white/5 p-3 rounded-lg"><Zap className="w-4 h-4 text-pink-400" /> Instagram Graph API</li>
                        <li className="flex items-center gap-2 bg-white/5 p-3 rounded-lg"><Zap className="w-4 h-4 text-blue-400" /> Messenger API</li>
                        <li className="flex items-center gap-2 bg-white/5 p-3 rounded-lg"><Zap className="w-4 h-4 text-purple-400" /> Google Gemini (AI)</li>
                    </ul>
                </div>
            </main>
        </div>
    );
}
