import Link from "next/link";
import { ArrowLeft, Scale, Clock, Users, CheckCircle2 } from "lucide-react";

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/developer/docs/load-balancing' });
}

export default function LoadBalancingDocs() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <StoredSeoJsonLd pathname="/developer/docs/load-balancing" />
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
                            Carga projetada e justiça por oportunidade
                        </h3>
                        <p className="text-white/70 mb-0">
                            A política por oportunidades combina <strong>carga projetada</strong>, capacidade e créditos proporcionais a quem realmente pode receber. A quantidade de conversas na carteira não tem limite e não bloqueia transferências, distribuição ou a ação de assumir atendimento. Avisos de transferência, notas internas, campanhas e envios pendentes ou com falha não contam como resposta. A ativação é gradual por workspace; a política anterior permanece disponível para reversão.
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
                                desc: "Se quem está transferindo também faz parte da equipe de destino, outros agentes elegíveis têm preferência. Se ele for o único disponível, a equipe não fica artificialmente indisponível.",
                                icon: CheckCircle2
                            },
                            {
                                title: "3. Carga Conversacional",
                                desc: "O sistema diferencia conversas exigindo resposta, conversas em atividade e conversas aguardando o cliente, sem confundir carteira total com trabalho simultâneo.",
                                icon: Clock
                            },
                            {
                                title: "4. Justiça e Seleção",
                                desc: "Na política por oportunidades, disputam agentes com ocupação projetada até 25 pontos percentuais acima da menor, protegendo quem ultrapassaria a capacidade quando há outra opção. Cada candidato acumula crédito proporcional à capacidade; recebe quem tem maior saldo e consome uma unidade. Ausências e pausas não acumulam dívida. Se todos estiverem acima da capacidade, recebe o menos ocupado. Não há teto de quantidade de conversas.",
                                icon: Scale
                            },
                            {
                                title: "5. Entrada Gradual",
                                desc: "Nos primeiros cinco minutos online, o agente recebe novas atribuições com intervalo de um minuto quando há outro colega elegível fora desse intervalo de espera. Se ele for a única opção, o atendimento continua sendo atribuído dentro da mesma equipe.",
                                icon: Clock
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
                        <li>Permite que novos agentes recebam atendimentos com entrada gradual no turno.</li>
                        <li>Elimina a necessidade de um supervisor distribuir manualmente os tickets.</li>
                        <li>Funciona em tempo real, adaptando-se instantaneamente a quem entra ou sai do turno (online/offline).</li>
                    </ul>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-6">
                        <h4 className="text-blue-400 font-bold mb-2">Nota Técnica</h4>
                        <p className="text-white/70 text-sm">
                            A verificação de presença é feita consultando a tabela <code>user_workspace_presence</code>, que é atualizada via WebSockets e Beacons. O critério considera presença com atualização recente ou atividade recente confirmada. A decisão final é transacional e o diagnóstico em Equipe → Roteamento mostra os motivos de exclusão e o histórico do turno.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
