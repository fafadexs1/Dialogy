const plans = [
    {
        eyebrow: 'PADRAO',
        price: 'A partir de R$ 59,90',
        tone: 'light',
        cta: 'Abrir simulador',
        href: '/pricing',
        items: ['Usuarios ilimitados', 'Slider de 500 a 5.000.000 chats/mes', '2 canais conectados', 'Teste gratis de 7 dias', 'Inbox unificado'],
    },
    {
        eyebrow: 'PROFISSIONAL',
        price: 'A partir de R$ 71,88',
        tone: 'dark',
        cta: 'Ver planos',
        href: '/pricing',
        highlight: 'MAIS ESCOLHIDO',
        items: ['Usuarios ilimitados', 'Mesmo volume mensal do slider', '5 canais conectados', 'Filas e equipes', 'SLA e distribuicao'],
    },
    {
        eyebrow: 'EMPRESARIAL',
        price: 'A partir de R$ 100,63',
        tone: 'light',
        cta: 'Simular volume',
        href: '/pricing',
        items: ['Usuarios ilimitados', 'Ate R$ 64.391,04 em 5.000.000 chats/mes', '12 canais conectados', 'Automacoes avancadas', 'API e webhooks'],
    },
    {
        eyebrow: 'VIP',
        price: 'Sob consulta',
        tone: 'light',
        cta: 'Projeto comercial',
        href: 'https://wa.me/551151994714',
        items: ['Usuarios ilimitados', 'Acima de 5.000.000 chats por mes', 'Implantacao sob medida', 'Suporte prioritario', 'Integracoes customizadas'],
    },
];

export const HighContrastPricing = () => {
    return (
        <section id="pricing" className="border-t border-black bg-[#f8f9fa] py-32">
            <div className="mx-auto max-w-7xl px-4 xl:px-0">
                <div className="mb-24">
                    <h2 className="max-w-3xl text-5xl font-black uppercase leading-none tracking-tighter text-black sm:text-7xl">
                        Preco por chat que escala sem travar a equipe.
                    </h2>
                    <p className="mt-6 max-w-2xl text-xl font-light leading-snug text-zinc-700">
                        O comercial agora gira em torno do volume mensal de chats: usuarios ilimitados, teste gratis de 7 dias e simulacao publica de 500 a 5.000.000 chats por mes.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-0 border border-black lg:grid-cols-4">
                    {plans.map((plan, index) => {
                        const dark = plan.tone === 'dark';

                        return (
                            <div
                                key={plan.eyebrow}
                                className={`flex flex-col justify-between border-black p-8 transition-colors lg:p-10 ${index < plans.length - 1 ? 'border-b lg:border-b-0 lg:border-r' : ''} ${dark ? 'relative overflow-hidden bg-black text-[#f8f9fa]' : 'bg-white text-black hover:bg-zinc-50'}`}
                            >
                                {dark && <div className="absolute right-0 top-0 h-16 w-16 bg-brand-green" />}

                                <div className="relative z-10">
                                    <div className={`mb-8 flex items-center justify-between font-mono text-sm font-bold uppercase tracking-widest ${dark ? 'text-brand-green' : 'text-zinc-500'}`}>
                                        {plan.eyebrow}
                                        {plan.highlight && <span className="bg-brand-green px-2 py-0.5 text-xs text-black">{plan.highlight}</span>}
                                    </div>

                                    <div className={`mb-8 flex items-baseline ${dark ? 'text-white' : 'text-black'}`}>
                                        <span className={`font-black tracking-tighter ${plan.price === 'Sob consulta' ? 'text-4xl' : 'text-5xl'}`}>{plan.price}</span>
                                        {plan.price !== 'Sob consulta' && (
                                            <span className="ml-2 text-sm font-mono uppercase text-zinc-700">/mes</span>
                                        )}
                                    </div>

                                    <ul className={`space-y-4 border-t py-8 font-light ${dark ? 'border-zinc-800 text-zinc-300' : 'border-zinc-200 text-zinc-700'}`}>
                                        {plan.items.map((item) => (
                                            <li key={item} className="flex items-center gap-3">
                                                <div className={`h-1.5 w-1.5 rounded-none ${dark ? 'bg-brand-green' : 'bg-black'}`} />
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <a
                                    href={plan.href}
                                    target={plan.href.startsWith('http') ? '_blank' : undefined}
                                    rel={plan.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                                    className={`relative z-10 mt-8 block py-4 text-center font-bold uppercase tracking-wider transition-colors ${dark ? 'bg-brand-green text-black hover:bg-white' : 'border border-black text-black hover:bg-black hover:text-[#f8f9fa]'}`}
                                >
                                    {plan.cta}
                                </a>
                            </div>
                        );
                    })}
                </div>

                <p className="mt-8 text-sm text-zinc-600">
                    O simulador completo fica na pagina de pricing. Acima de 5.000.000 chats por mes, a Dialogy fecha proposta VIP com desenho comercial e operacional dedicado.
                </p>
            </div>
        </section>
    );
};
