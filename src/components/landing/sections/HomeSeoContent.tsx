import { DialogyBentoGrid } from './DialogyBentoGrid';
import { FAQSection } from '@/components/ui/faqsection';
import { HOME_FAQ_ITEMS } from '@/content/home-seo';

export function HomeSeoContent() {
    const halfIndex = Math.ceil(HOME_FAQ_ITEMS.length / 2);
    const faqsLeft = HOME_FAQ_ITEMS.slice(0, halfIndex);
    const faqsRight = HOME_FAQ_ITEMS.slice(halfIndex);

    return (
        <section
            id="crm-whatsapp"
            aria-labelledby="home-seo-heading"
            className="border-t border-white/5 bg-transparent px-4 py-20 sm:px-6 md:py-28"
        >
            <div className="mx-auto max-w-[1280px]">
                {/* Product Features Bento Grid */}
                <DialogyBentoGrid />

                <div className="mt-16">
                    <FAQSection 
                        title="FAQ sobre chatbot para WhatsApp e atendimento omnichannel"
                        subtitle="Perguntas Frequentes"
                        description="Tudo o que você precisa saber sobre como a plataforma combina chatbot, omnichannel e IA para vendas e atendimento."
                        buttonLabel="Ver planos e precos"
                        faqsLeft={faqsLeft}
                        faqsRight={faqsRight}
                    />
                </div>
            </div>
        </section>
    );
}
