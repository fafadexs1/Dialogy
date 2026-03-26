export const MinimalFooter = () => {
    return (
        <footer className="border-t border-black bg-[#f8f9fa] pb-12 pt-32">
            <div className="mx-auto max-w-7xl px-4 xl:px-0">
                <div className="mb-32 flex flex-col items-center justify-center text-center">
                    <h4 className="mb-12 text-6xl font-black uppercase leading-none tracking-tighter text-black sm:text-8xl md:text-9xl">
                        Sua Vez.
                    </h4>

                    <a
                        href="/register"
                        className="group relative inline-flex items-center justify-center overflow-hidden bg-black px-12 py-6 text-xl font-bold text-[#f8f9fa] transition-transform hover:scale-105 active:scale-95 md:text-2xl"
                    >
                        <span className="relative z-10 flex items-center gap-3">
                            Iniciar Automacao
                            <svg className="h-6 w-6 transition-transform group-hover:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </span>
                        <div className="absolute inset-0 z-0 translate-y-full bg-brand-green transition-transform duration-300 ease-out group-hover:translate-y-0" />
                        <span className="absolute inset-0 relative z-10 flex items-center justify-center gap-3 text-black opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                            Iniciar Automacao
                            <svg className="h-6 w-6 transition-transform group-hover:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </span>
                    </a>
                </div>

                <div className="grid grid-cols-2 gap-12 border-t border-black pt-12 md:grid-cols-4">
                    <div>
                        <h5 className="mb-6 font-bold uppercase tracking-tighter">Plataforma</h5>
                        <ul className="space-y-4 font-light text-zinc-700">
                            <li><a href="#omnichannel" className="underline-offset-4 hover:text-black hover:underline">Omnichannel</a></li>
                            <li><a href="/developer" className="underline-offset-4 hover:text-black hover:underline">Developer</a></li>
                            <li><a href="/pricing" className="underline-offset-4 hover:text-black hover:underline">Precos</a></li>
                        </ul>
                    </div>
                    <div>
                        <h5 className="mb-6 font-bold uppercase tracking-tighter">Empresa</h5>
                        <ul className="space-y-4 font-light text-zinc-700">
                            <li><a href="/about" className="underline-offset-4 hover:text-black hover:underline">Sobre nos</a></li>
                            <li><a href="#demo" className="underline-offset-4 hover:text-black hover:underline">Demo</a></li>
                            <li><a href="/register" className="underline-offset-4 hover:text-black hover:underline">Contato</a></li>
                        </ul>
                    </div>
                    <div>
                        <h5 className="mb-6 font-bold uppercase tracking-tighter">Legal</h5>
                        <ul className="space-y-4 font-light text-zinc-700">
                            <li><a href="/terms" className="underline-offset-4 hover:text-black hover:underline">Termos de uso</a></li>
                            <li><a href="/privacy" className="underline-offset-4 hover:text-black hover:underline">Privacidade</a></li>
                            <li><a href="/developer" className="underline-offset-4 hover:text-black hover:underline">DPA</a></li>
                        </ul>
                    </div>
                    <div className="flex flex-col justify-between md:text-right">
                        <div>
                            <div className="mb-2 text-3xl font-black uppercase tracking-tighter">Dialogy</div>
                            <p className="font-mono text-sm text-zinc-600">I.A. / Automacao / CRM</p>
                        </div>
                    </div>
                </div>

                <div className="mt-24 flex flex-col items-center justify-between border-t border-zinc-200 pt-8 text-center font-mono text-xs uppercase tracking-widest text-zinc-500 md:flex-row md:text-left">
                    <span>&copy; {new Date().getFullYear()} DIALOGY INC. TODOS OS DIREITOS RESERVADOS.</span>
                    <span className="mt-4 md:mt-0">SISTEMA OPERACIONAL.</span>
                </div>
            </div>
        </footer>
    );
};
