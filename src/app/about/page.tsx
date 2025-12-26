import { getSeoMetadata } from '@/lib/seo-helper';
import { Navbar } from '@/components/landing/navbar';
import { Footer } from '@/components/landing/footer';
import { Section } from '@/components/landing/ui';

export async function generateMetadata() {
    return getSeoMetadata({
        pathname: '/about',
        fallbackTitle: 'Sobre Nós | Dialogy',
        fallbackDescription: 'Conheça a missão e os valores por trás da Dialogy, a plataforma líder em automação de comunicação.',
    });
}

export default function AboutPage() {
    return (
        <div className="min-h-screen w-full bg-[#020617] text-white">
            <Navbar />
            <main className="pt-32 pb-20">
                <Section>
                    <h1 className="text-5xl font-bold mb-8">Sobre a Dialogy</h1>
                    <p className="text-xl text-white/70 max-w-3xl leading-relaxed">
                        Estamos construindo o futuro da comunicação entre empresas e clientes.
                        Acreditamos que a automação não deve soar robótica, mas sim empoderar humanos a fazerem mais.
                    </p>
                </Section>
            </main>
            <Footer />
        </div>
    );
}
