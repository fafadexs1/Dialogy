'use client';

import React from 'react';
import { Twitter, Linkedin, Github } from 'lucide-react';
import { InstagramIcon } from './ui/Icons';

export function Footer() {
    return (
        <footer className="bg-[#050507] border-t border-white/10 pt-20 pb-10 px-4">
            <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-10 mb-16">
                <div className="col-span-2 lg:col-span-2">
                    <div className="mb-6">
                        <img
                            src="/logo.png"
                            alt="Dialogy Logo"
                            className="h-8 md:h-10 w-auto object-contain"
                        />
                    </div>
                    <p className="text-gray-400 text-sm mb-6 max-w-xs">
                        A plataforma definitiva de atendimento omnichannel e vendas com IA.
                    </p>
                    <div className="flex gap-4">
                        <a href="#" className="text-gray-500 hover:text-white transition-colors"><Twitter size={20} /></a>
                        <a href="#" className="text-gray-500 hover:text-white transition-colors"><Linkedin size={20} /></a>
                        <a href="#" className="text-gray-500 hover:text-white transition-colors"><InstagramIcon className="w-5 h-5" /></a>
                    </div>
                </div>

                <div>
                    <h4 className="font-semibold text-white mb-4">Produto</h4>
                    <ul className="space-y-2 text-sm text-gray-400">
                        <li><a href="#" className="hover:text-brand-green transition-colors">Inbox</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Autopilot IA</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Automação</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Integrações</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Changelog</a></li>
                    </ul>
                </div>

                <div>
                    <h4 className="font-semibold text-white mb-4">Recursos</h4>
                    <ul className="space-y-2 text-sm text-gray-400">
                        <li><a href="#" className="hover:text-brand-green transition-colors">Blog</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Comunidade</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Help Center</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">API Docs</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Status</a></li>
                    </ul>
                </div>

                <div>
                    <h4 className="font-semibold text-white mb-4">Empresa</h4>
                    <ul className="space-y-2 text-sm text-gray-400">
                        <li><a href="#" className="hover:text-brand-green transition-colors">Sobre</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Carreiras</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Legal</a></li>
                        <li><a href="#" className="hover:text-brand-green transition-colors">Contato</a></li>
                    </ul>
                </div>
            </div>

            <div className="max-w-7xl mx-auto pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-xs text-gray-600 gap-4">
                <div className="flex flex-col md:flex-row gap-1 md:gap-4 items-center text-center md:text-left">
                    <p>&copy; 2024 Dialogy.</p>
                    <span className="hidden md:inline text-white/10">|</span>
                    <p>Klyraai Inova Simples (I.S.) • CNPJ 63.905.247/0001-77</p>
                </div>
                <div className="flex gap-6">
                    <a href="#" className="hover:text-gray-400">Privacidade</a>
                    <a href="#" className="hover:text-gray-400">Termos</a>
                    <a href="#" className="hover:text-gray-400">Cookies</a>
                </div>
            </div>
        </footer>
    );
}
