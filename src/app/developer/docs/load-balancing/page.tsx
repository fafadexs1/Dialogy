'use client';

import React from "react";
import Link from "next/link";
import { Code2, ArrowLeft, Scale, Clock, Users, CheckCircle2 } from "lucide-react";

export default function LoadBalancingDocs() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/developer" className="font-bold text-xl tracking-tight flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Code2 className="w-5 h-5 text-white" />
                            </div>
                            Dialogy <span className="text-white/40 font-normal">Docs</span>
                        </Link>
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
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-6">
                        <Scale className="w-3 h-3" /> Core Features
                    </div>
                    <h1 className="text-4xl font-bold mb-6">Sistema de Balanceamento de Carga</h1>
                    <p className="text-xl text-white/60 leading-relaxed">
                        Entenda como o Dialogy distribui automaticamente os atendimentos entre sua equipe para garantir eficiência e justiça na distribuição de trabalho.
                    </p>
                </div>

                <div className="prose prose-invert max-w-none">
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 mb-10">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-blue-400" />
                            Algoritmo "Least Recently Assigned" (LRA)
                        </h3>
                        <p className="text-white/70 mb-0">
                            O Dialogy utiliza uma variação do algoritmo <strong>Least Recently Assigned</strong>. Isso significa que, ao transferir um chat para uma equipe, o sistema busca o agente que está <strong>há mais tempo sem receber um novo atendimento</strong>.
                        </p>
                    </div>

                    <h2 className="text-2xl font-bold mb-6">Como funciona a decisão?</h2>
                    <p className="text-white/60 mb-6">
                        Quando um atendimento é transferido para uma equipe (ex: "Suporte Nível 1"), o sistema executa a seguinte lógica de seleção em tempo real:
                    </p>

                    <div className="grid gap-6 mb-12">
                        {[
                            {
                                title: "1. Filtro de Disponibilidade",
                                desc: "O sistema identifica todos os membros da equipe de destino que estão atualmente ONLINE na plataforma.",
                                icon: Users
                            },
                            {
                                title: "2. Exclusão do Remetente",
                                desc: "Se quem está transferindo também faz parte da equipe de destino, ele é excluído da seleção para evitar que o chat volte para ele mesmo.",
                                icon: CheckCircle2
                            },
                            {
                                title: "3. Análise Temporal",
                                desc: "Para cada agente disponível, o sistema verifica o timestamp da última vez que um chat foi atribuído a ele (assigned_at).",
                                icon: Clock
                            },
                            {
                                title: "4. Ordenação e Seleção",
                                desc: "Os agentes são ordenados de forma que quem recebeu um chat há mais tempo (ou nunca recebeu) fica no topo da lista. Em caso de empate exato, um sorteio randômico é feito.",
                                icon: Scale
                            }
                        ].map((step, i) => (
                            <div key={i} className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 font-bold text-blue-400 border border-blue-600/30">
                                    {i + 1}
                                </div>
                                <div>
                                    <h3 className="font-bold text-white mb-1">{step.title}</h3>
                                    <p className="text-white/60 text-sm leading-relaxed">{step.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <h2 className="text-2xl font-bold mb-4">Benefícios</h2>
                    <ul className="space-y-3 text-white/60 mb-8 list-disc pl-6">
                        <li>Evita sobrecarga de agentes específicos.</li>
                        <li>Garante que novos agentes comecem a receber atendimentos imediatamente (pois seu "último atendimento" é nulo/antigo).</li>
                        <li>Elimina a necessidade de um supervisor distribuir manualmente os tickets.</li>
                        <li>Funciona em tempo real, adaptando-se instantaneamente a quem entra ou sai do turno (online/offline).</li>
                    </ul>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-6">
                        <h4 className="text-blue-400 font-bold mb-2">Nota Técnica</h4>
                        <p className="text-white/70 text-sm">
                            A verificação de presença é feita consultando a tabela <code>user_workspace_presence</code>, que é atualizada via WebSockets e Beacons. Isso garante que apenas agentes com a aba aberta e conexão ativa recebam novos chats.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
