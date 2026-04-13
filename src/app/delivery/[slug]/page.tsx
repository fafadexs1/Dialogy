import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublicVitrineBySlug } from '@/actions/delivery-hub-vitrines';
import { normalizeDeliveryHubSlug } from '@/lib/delivery-hub';
import { Info, ReceiptText, Search, Star } from 'lucide-react';

export const dynamic = 'force-dynamic';

function formatPrice(price: string): string {
  const trimmed = price.trim();
  if (!trimmed) return '';
  if (/^r\$/i.test(trimmed) || /[a-zA-Z]/.test(trimmed)) return trimmed;
  return `R$ ${trimmed}`;
}

type DeliveryPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: DeliveryPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const slug = normalizeDeliveryHubSlug(resolvedParams.slug);
  const result = await getPublicVitrineBySlug(slug);

  if (!result.success || !result.vitrine) {
    return { title: 'Delivery' };
  }

  const business = result.vitrine.businesses[0]; // Always use the first business

  if (!business) {
    return { title: `${result.vitrine.title} | Delivery` };
  }

  return {
    title: `${business.name || 'Restaurante'} — ${result.vitrine.title}`,
    description: business.description || result.vitrine.subtitle,
  };
}

export default async function DeliveryPublicPage({ params }: DeliveryPageProps) {
  const resolvedParams = await params;
  const result = await getPublicVitrineBySlug(resolvedParams.slug);

  if (!result.success || !result.vitrine || !result.vitrine.isPublished) {
    notFound();
  }

  const { vitrine } = result;
  
  // Directly use the first configured business
  const business = vitrine.businesses[0];

  if (!business) {
    // Elegant fallback if no business is configured yet
    return (
      <div className="flex min-h-screen justify-center bg-zinc-100 sm:py-6 sm:px-4">
        <main className="flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-white p-6 shadow-2xl sm:min-h-[850px] sm:max-h-[90vh] sm:rounded-[40px] sm:border-[10px] sm:border-slate-900 ring-1 ring-slate-200">
           <h2 className="text-xl font-bold text-slate-800 text-center">Nenhum restaurante configurado</h2>
           <p className="mt-2 text-slate-500 text-center">Volte mais tarde quando o cardápio estiver disponível.</p>
        </main>
      </div>
    );
  }

  // Simulating a rating
  const fakeRating = "4.8";
  
  // Flatten items to count
  const itemsCount = business.menuSections.reduce((acc, section) => acc + section.items.length, 0);

  return (
    <div className="flex min-h-screen justify-center bg-zinc-100 sm:py-6 sm:px-4">
      <main className="relative flex min-h-[100dvh] w-full max-w-md flex-col bg-slate-50 overflow-hidden shadow-2xl sm:min-h-[850px] sm:max-h-[850px] sm:rounded-[40px] sm:border-[10px] sm:border-slate-900 ring-1 ring-slate-200">
        
        {/* ─── Cover / Hero / Banner ─────────────────────────────────────── */}
        <div className="relative h-[200px] w-full bg-slate-200">
          {business.coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={business.coverUrl} alt={business.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-tr from-teal-500 to-teal-400" />
          )}
          
          {/* Gradient Overlay for Top Nav */}
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
          
          {/* Info Button Top Right */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-end p-4 pt-10 sm:pt-6">
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm backdrop-blur-md active:scale-95 transition-transform">
              <Info className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-28 scroll-smooth scrollbar-none z-10">
          
          {/* ─── Business Info Card Overlapping ──────────────────────────── */}
          <div className="-mt-12 px-4 relative z-20">
            <div className="rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-slate-100 flex flex-col items-center text-center">
              
              {/* Logo (Fake or from cover if any, we'll placeholder a circle) */}
              <div className="absolute -top-[36px] left-1/2 -translate-x-1/2 h-[72px] w-[72px] overflow-hidden rounded-full border-4 border-white bg-white shadow-sm ring-1 ring-slate-100">
                 {business.coverUrl ? (
                   /* eslint-disable-next-line @next/next/no-img-element */
                   <img src={business.coverUrl} className="h-full w-full object-cover" alt="Logo" />
                 ) : (
                   <div className="flex h-full w-full items-center justify-center bg-teal-50 text-2xl font-black text-teal-600">
                     {business.name?.charAt(0) || 'L'}
                   </div>
                 )}
              </div>

              <div className="mt-8 w-full">
                <h1 className="text-[22px] font-bold text-slate-800">{business.name || 'Nome do Estabelecimento'}</h1>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-500">
                  <span className="truncate">{business.category || 'Categoria'}</span>
                  <span className="text-slate-300">•</span>
                  <span>{business.deliveryTime || '30-45 min'}</span>
                </div>
                
                <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-1.5">
                    <Star className="h-[18px] w-[18px] fill-amber-500 text-amber-500" />
                    <span className="font-bold text-amber-500">{fakeRating}</span>
                  </div>
                  <div className="text-[13px] text-slate-500 flex items-center font-medium">
                    {business.deliveryFee === '0' || business.deliveryFee?.toLowerCase() === 'grátis' || business.deliveryFee?.toLowerCase() === 'gratis' ? <span className="text-emerald-600">Entrega Grátis</span> : (business.deliveryFee || 'Frete não config.')}
                  </div>
                  <div className="text-[13px] text-slate-500 flex items-center font-medium">
                    Mín. {business.minimumOrder || 'R$ 0'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 mt-6 mb-2">
            {business.description && (
              <p className="mb-6 text-[13px] text-slate-500 leading-relaxed text-center px-4">
                {business.description}
              </p>
            )}
            <div className="flex items-center gap-3 rounded-[16px] bg-slate-100 px-4 py-3 focus-within:ring-2 focus-within:ring-teal-500">
              <Search className="h-5 w-5 text-slate-400" />
              <input 
                type="text"
                placeholder="Busque no cardápio"
                className="flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* ─── Menu Categories Tab Scroll ───────────────────────────────── */}
          {business.menuSections.length > 0 && (
             <div className="sticky top-0 z-20 bg-slate-50 border-b border-slate-100 shadow-sm mt-3 pt-2">
               <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-3 scrollbar-none">
                 {business.menuSections.map((sec, i) => (
                   <div key={i} className="shrink-0 snap-center">
                     <button className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${i === 0 ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
                       {sec.title || 'Seção'}
                     </button>
                   </div>
                 ))}
               </div>
             </div>
          )}

          {/* ─── Menu Sections and Items ──────────────────────────────────── */}
          <div className="mt-2 text-slate-800">
            {business.menuSections.map((section, sIdx) => (
              <div key={section.id} className="pt-6">
                <div className="px-5">
                   <h2 className="text-xl font-bold text-slate-900">{section.title || 'Seção'}</h2>
                   {section.description && (
                     <p className="mt-1 text-[13px] text-slate-500 line-clamp-2">{section.description}</p>
                   )}
                </div>

                <div className="mt-4 flex flex-col px-5 divide-y divide-slate-100 bg-white">
                  {section.items.map((item) => (
                    <div key={item.id} className="flex gap-4 py-5 group cursor-pointer active:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0 pr-2">
                        <h3 className="text-[15px] font-bold text-slate-800">{item.name || 'Item'}</h3>
                        {item.description && (
                          <p className="mt-1 line-clamp-2 text-[13px] text-slate-500">{item.description}</p>
                        )}
                        <div className="mt-2.5 flex items-center gap-2">
                          <span className="text-[15px] font-bold text-teal-700">
                            {formatPrice(item.price)}
                          </span>
                        </div>
                      </div>
                      
                      {item.imageUrl && (
                        <div className="h-[90px] w-[90px] shrink-0 overflow-hidden rounded-[16px] border border-slate-100 bg-slate-50 shadow-sm relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                          <div className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md font-bold text-teal-600 leading-none pb-0.5 text-lg">+</div>
                        </div>
                      )}
                      
                      {!item.imageUrl && (
                         <div className="flex flex-col items-end">
                           <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 border border-slate-100 shadow-sm font-bold text-teal-600 leading-none pb-0.5 text-xl">+</div>
                         </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* ─── Bottom Floating Action Bar ──────────────────────────────── */}
        <div className="absolute bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md shadow-[0_-5px_30px_rgba(0,0,0,0.05)] border-t border-slate-100 sm:rounded-b-[32px]">
          <div className="p-4 sm:p-5">
             <Link
               href={business.orderUrl || '#'}
               target="_blank"
               rel="noreferrer"
               className="flex h-12 w-full items-center justify-between rounded-[16px] bg-teal-600 px-5 text-white active:scale-[0.98] transition-all shadow-md active:bg-teal-700"
             >
               <div className="flex items-center gap-2">
                 <ReceiptText className="h-[22px] w-[22px]" />
                 <span className="text-[15px] font-bold">Ver sacola</span>
               </div>
               <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded-full">{itemsCount} itens</span>
             </Link>
          </div>
        </div>

      </main>
    </div>
  );
}
