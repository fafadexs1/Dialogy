'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';

import {
  listVitrines,
  createVitrine,
  saveVitrine,
  deleteVitrine,
} from '@/actions/delivery-hub-vitrines';
import {
  buildDeliveryHubShareUrl,
  buildBusinessShareUrl,
  normalizeDeliveryHubSlug,
  type DeliveryHubBusiness,
  type DeliveryHubMenuItem,
  type DeliveryHubMenuSection,
  type DeliveryHubVitrine,
} from '@/lib/delivery-hub';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShoppingBag,
  Store,
  Trash2,
} from 'lucide-react';

/* ─── helpers ─────────────────────────────────────────────────────── */

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMenuItem(): DeliveryHubMenuItem {
  return { id: createId('item'), name: '', description: '', price: '', imageUrl: '' };
}

function createMenuSection(): DeliveryHubMenuSection {
  return { id: createId('section'), title: '', description: '', items: [createMenuItem()] };
}

function createBusiness(): DeliveryHubBusiness {
  return {
    id: createId('business'),
    name: '',
    category: '',
    description: '',
    coverUrl: '',
    deliveryTime: '',
    deliveryFee: '',
    minimumOrder: '',
    orderUrl: '',
    menuSections: [createMenuSection()],
  };
}

/* ─── Mini vitrine card (list view) ──────────────────────────────── */

function VitrineCard({
  vitrine,
  onEdit,
  onDelete,
}: {
  vitrine: DeliveryHubVitrine;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const businessCount = vitrine.businesses.length;
  const itemCount = vitrine.businesses.reduce(
    (t, b) => t + b.menuSections.reduce((s, sec) => s + sec.items.length, 0),
    0
  );
  const shareUrl = useMemo(() => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return buildDeliveryHubShareUrl(baseUrl, vitrine.slug);
  }, [vitrine.slug]);

  return (
    <Card className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 transition-all duration-300 hover:border-orange-500/30 hover:shadow-[0_16px_48px_-20px_rgba(249,115,22,0.25)]">
      {/* Gradient accent top */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-400 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-lg">{vitrine.title || 'Sem titulo'}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs">{vitrine.subtitle || 'Sem descricao'}</CardDescription>
          </div>
          <Badge
            variant={vitrine.isPublished ? 'default' : 'outline'}
            className={
              vitrine.isPublished
                ? 'shrink-0 border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                : 'shrink-0 border-border/60 text-muted-foreground'
            }
          >
            {vitrine.isPublished ? 'Publicado' : 'Rascunho'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-border/50 bg-background/60 p-3 text-center">
            <p className="text-xl font-bold">{businessCount}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Negócios</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-3 text-center">
            <p className="text-xl font-bold">
              {vitrine.businesses.reduce((t, b) => t + b.menuSections.length, 0)}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Seções</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-3 text-center">
            <p className="text-xl font-bold">{itemCount}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Itens</p>
          </div>
        </div>

        {vitrine.slug && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border/50 bg-background/60 px-3 py-2">
            <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="truncate text-xs text-muted-foreground">/delivery/{vitrine.slug}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2 pt-2">
        <Button variant="default" size="sm" className="flex-1" onClick={onEdit}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Button>
        {shareUrl && (
          <Button variant="outline" size="sm" asChild>
            <Link href={shareUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ─── Vitrine Editor ─────────────────────────────────────────────── */

function VitrineEditor({
  vitrine: initialVitrine,
  onSaved,
  onBack,
}: {
  vitrine: DeliveryHubVitrine;
  onSaved: (vitrine: DeliveryHubVitrine) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [config, setConfig] = useState(initialVitrine);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [openBusinesses, setOpenBusinesses] = useState<string[]>(
    initialVitrine.businesses.map((b) => b.id)
  );
  const [editingItem, setEditingItem] = useState<{ bIdx: number; sIdx: number; iIdx: number; item: DeliveryHubMenuItem; isNew: boolean } | null>(null);

  const shareUrl = useMemo(() => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return buildDeliveryHubShareUrl(baseUrl, config.slug);
  }, [config.slug]);

  const stats = useMemo(() => {
    const sections = config.businesses.reduce((t, b) => t + b.menuSections.length, 0);
    const items = config.businesses.reduce(
      (t, b) => t + b.menuSections.reduce((s, sec) => s + sec.items.length, 0),
      0
    );
    return { businesses: config.businesses.length, sections, items };
  }, [config.businesses]);

  /* ── Mutations ────────────────────────── */

  const setBusiness = useCallback(
    (idx: number, updater: (b: DeliveryHubBusiness) => DeliveryHubBusiness) => {
      setConfig((c) => ({
        ...c,
        businesses: c.businesses.map((b, i) => (i === idx ? updater(b) : b)),
      }));
    },
    []
  );

  const setSection = useCallback(
    (bIdx: number, sIdx: number, updater: (s: DeliveryHubMenuSection) => DeliveryHubMenuSection) => {
      setBusiness(bIdx, (b) => ({
        ...b,
        menuSections: b.menuSections.map((s, i) => (i === sIdx ? updater(s) : s)),
      }));
    },
    [setBusiness]
  );

  const setItem = useCallback(
    (bIdx: number, sIdx: number, iIdx: number, updater: (i: DeliveryHubMenuItem) => DeliveryHubMenuItem) => {
      setSection(bIdx, sIdx, (s) => ({
        ...s,
        items: s.items.map((item, i) => (i === iIdx ? updater(item) : item)),
      }));
    },
    [setSection]
  );

  const handleAddBusiness = () => {
    const next = createBusiness();
    setConfig((c) => ({ ...c, businesses: [...c.businesses, next] }));
    setOpenBusinesses((ids) => [...ids, next.id]);
  };

  const handleRemoveBusiness = (idx: number) => {
    setConfig((c) => ({ ...c, businesses: c.businesses.filter((_, i) => i !== idx) }));
  };

  const handleAddSection = (bIdx: number) => {
    setBusiness(bIdx, (b) => ({ ...b, menuSections: [...b.menuSections, createMenuSection()] }));
  };

  const handleRemoveSection = (bIdx: number, sIdx: number) => {
    setBusiness(bIdx, (b) => ({ ...b, menuSections: b.menuSections.filter((_, i) => i !== sIdx) }));
  };

  const handleAddItem = (bIdx: number, sIdx: number) => {
    const sectionItems = config.businesses[bIdx].menuSections[sIdx].items;
    setEditingItem({
      bIdx,
      sIdx,
      iIdx: sectionItems.length,
      item: createMenuItem(),
      isNew: true,
    });
  };

  const handleEditItem = (bIdx: number, sIdx: number, iIdx: number) => {
    const item = config.businesses[bIdx].menuSections[sIdx].items[iIdx];
    setEditingItem({
      bIdx,
      sIdx,
      iIdx,
      item: { ...item },
      isNew: false,
    });
  };

  const handleSaveItemModal = () => {
    if (!editingItem) return;
    const { bIdx, sIdx, iIdx, item, isNew } = editingItem;
    
    setSection(bIdx, sIdx, (s) => {
      const newItems = [...s.items];
      if (isNew) {
        newItems.push(item);
      } else {
        newItems[iIdx] = item;
      }
      return { ...s, items: newItems };
    });
    
    setEditingItem(null);
  };

  const handleRemoveItem = (bIdx: number, sIdx: number, iIdx: number) => {
    setSection(bIdx, sIdx, (s) => ({ ...s, items: s.items.filter((_, i) => i !== iIdx) }));
  };

  const handleCopyLink = async (url: string, label: string) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(label);
    toast({ title: 'Link copiado', description: `Link ${label} copiado para a area de transferencia.` });
    window.setTimeout(() => setCopied(null), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await saveVitrine(config.id, {
      title: config.title,
      subtitle: config.subtitle,
      slug: config.slug,
      isPublished: config.isPublished,
      businesses: config.businesses,
    });
    setSaving(false);

    if (!result.success || !result.vitrine) {
      toast({
        title: 'Falha ao salvar',
        description: result.error || 'Erro ao salvar vitrine.',
        variant: 'destructive',
      });
      return;
    }

    setConfig(result.vitrine);
    setOpenBusinesses(result.vitrine.businesses.map((b) => b.id));
    onSaved(result.vitrine);
    toast({
      title: 'Vitrine salva',
      description: result.vitrine.isPublished
        ? 'Vitrine publicada e pronta para compartilhar!'
        : 'Rascunho salvo com sucesso.',
    });
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{config.title || 'Sem titulo'}</h2>
            <p className="text-sm text-muted-foreground">Editando vitrine</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="min-w-[160px]">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar vitrine'}
        </Button>
      </div>

      {/* Config + Stats */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70 bg-card/60">
          <CardHeader>
            <CardTitle>Configuracao publica</CardTitle>
            <CardDescription>Titulo, subtitulo, slug e status de publicacao desta vitrine.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="vitrine-title">Titulo da vitrine</Label>
              <Input
                id="vitrine-title"
                value={config.title}
                onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
                placeholder="Ex: Praca de alimentacao"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vitrine-subtitle">Subtitulo</Label>
              <Textarea
                id="vitrine-subtitle"
                value={config.subtitle}
                onChange={(e) => setConfig((c) => ({ ...c, subtitle: e.target.value }))}
                placeholder="Uma descricao curta para seus clientes."
                className="min-h-[100px]"
              />
            </div>
            <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="vitrine-slug">Slug do link publico</Label>
                <Input
                  id="vitrine-slug"
                  value={config.slug}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, slug: normalizeDeliveryHubSlug(e.target.value) }))
                  }
                  placeholder="ex: centro-food"
                />
                <p className="text-xs text-muted-foreground">
                  Letras, numeros e hifens. Link unico para esta vitrine.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 md:min-w-[220px]">
                <div>
                  <p className="text-sm font-medium">Publicar</p>
                  <p className="text-xs text-muted-foreground">
                    {config.isPublished ? 'Acessivel no link.' : 'Privada ate publicar.'}
                  </p>
                </div>
                <Switch
                  checked={config.isPublished}
                  onCheckedChange={(checked) => setConfig((c) => ({ ...c, isPublished: checked }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/60">
          <CardHeader>
            <CardTitle>Link e resumo</CardTitle>
            <CardDescription>Copie o link e veja o volume do catalogo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Link publico</p>
              <p className="mt-2 break-all text-sm font-medium">{shareUrl || 'Defina um slug para gerar.'}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Negocios', value: stats.businesses },
                { label: 'Secoes', value: stats.sections },
                { label: 'Itens', value: stats.items },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => handleCopyLink(shareUrl, 'vitrine')} disabled={!shareUrl}>
              {copied === 'vitrine' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied === 'vitrine' ? 'Copiado' : 'Copiar link'}
            </Button>
            <Button variant="outline" asChild disabled={!shareUrl}>
              <Link href={shareUrl || '#'} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir vitrine
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Businesses */}
      <Card className="border-border/70 bg-card/60">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Informações do Restaurante</CardTitle>
            <CardDescription>
              Configure os dados e o cardápio principal do seu delivery.
            </CardDescription>
          </div>
          {config.businesses.length === 0 && (
            <Button onClick={handleAddBusiness}>
              <Plus className="mr-2 h-4 w-4" />
              Configurar restaurante
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {config.businesses.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-background/60 px-6 py-14 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-400">
                <Store className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Nenhum restaurante configurado</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                Inicie a configuração do seu cardápio de delivery adicionando as informações básicas.
              </p>
              <Button className="mt-6" onClick={handleAddBusiness}>
                <Plus className="mr-2 h-4 w-4" />
                Configurar restaurante
              </Button>
            </div>
          ) : (
            <Accordion type="multiple" value={openBusinesses} onValueChange={setOpenBusinesses} className="space-y-4">
              {config.businesses.map((business, bIdx) => {
                const itemCount = business.menuSections.reduce((t, s) => t + s.items.length, 0);
                const businessLink = buildBusinessShareUrl(baseUrl, config.slug, business.id);

                return (
                  <AccordionItem
                    key={business.id}
                    value={business.id}
                    className="overflow-hidden rounded-3xl border border-border/70 bg-background/60"
                  >
                    <AccordionTrigger className="px-5 py-4 hover:no-underline">
                      <div className="flex flex-1 flex-col items-start gap-3 text-left sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <p className="text-lg font-semibold">{business.name || `Cardápio Principal`}</p>
                            {business.category && <Badge variant="outline">{business.category}</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {business.description || 'Sem descricao'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{business.menuSections.length} secoes</span>
                          <span>{itemCount} itens</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-6 px-5 pb-5">
                      {/* Link individual do negocio */}
                      {businessLink && (
                        <div className="flex items-center gap-2 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3">
                          <Link2 className="h-4 w-4 shrink-0 text-orange-400" />
                          <p className="flex-1 truncate text-xs text-muted-foreground">{businessLink}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyLink(businessLink, business.id)}
                          >
                            {copied === business.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      )}

                      {/* Remover Negocio button was removed to prevent accidental deletion, but we can keep it as Reset */}
                      <div className="flex justify-end">
                        <Button variant="outline" onClick={() => handleRemoveBusiness(bIdx)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover restaurante
                        </Button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Nome do negocio</Label>
                          <Input
                            value={business.name}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, name: e.target.value }))}
                            placeholder="Ex: Acai Prime"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Categoria</Label>
                          <Input
                            value={business.category}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, category: e.target.value }))}
                            placeholder="Ex: Acai, Pizza"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Descricao</Label>
                        <Textarea
                          value={business.description}
                          onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, description: e.target.value }))}
                          placeholder="Resumo rapido do negocio."
                        />
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Imagem de capa (URL)</Label>
                          <Input
                            value={business.coverUrl}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, coverUrl: e.target.value }))}
                            placeholder="https://..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Link de pedido</Label>
                          <Input
                            value={business.orderUrl}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, orderUrl: e.target.value }))}
                            placeholder="https://wa.me/..."
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Tempo de entrega</Label>
                          <Input
                            value={business.deliveryTime}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, deliveryTime: e.target.value }))}
                            placeholder="30 a 45 min"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Taxa de entrega</Label>
                          <Input
                            value={business.deliveryFee}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, deliveryFee: e.target.value }))}
                            placeholder="R$ 6,00"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Pedido minimo</Label>
                          <Input
                            value={business.minimumOrder}
                            onChange={(e) => setBusiness(bIdx, (b) => ({ ...b, minimumOrder: e.target.value }))}
                            placeholder="R$ 20,00"
                          />
                        </div>
                      </div>

                      {/* Menu Sections */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-semibold">Secoes do cardapio</h3>
                            <p className="text-sm text-muted-foreground">
                              Combos, bebidas, pizzas, sobremesas, etc.
                            </p>
                          </div>
                          <Button variant="outline" onClick={() => handleAddSection(bIdx)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar secao
                          </Button>
                        </div>

                        {business.menuSections.map((section, sIdx) => (
                          <div key={section.id} className="space-y-4 rounded-3xl border border-border/70 bg-card/50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold">{section.title || `Secao ${sIdx + 1}`}</p>
                                <p className="text-xs text-muted-foreground">{section.items.length} itens</p>
                              </div>
                              <Button variant="ghost" onClick={() => handleRemoveSection(bIdx, sIdx)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remover secao
                              </Button>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <Label>Titulo da secao</Label>
                                <Input
                                  value={section.title}
                                  onChange={(e) =>
                                    setSection(bIdx, sIdx, (s) => ({ ...s, title: e.target.value }))
                                  }
                                  placeholder="Ex: Combos da casa"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Descricao da secao</Label>
                                <Input
                                  value={section.description}
                                  onChange={(e) =>
                                    setSection(bIdx, sIdx, (s) => ({ ...s, description: e.target.value }))
                                  }
                                  placeholder="Ex: Mais pedidos"
                                />
                              </div>
                            </div>

                            <div className="space-y-3">
                              {section.items.map((item, iIdx) => (
                                <div key={item.id} className="flex items-start gap-4 rounded-2xl border border-border/70 bg-background/80 p-4 transition-all hover:bg-background/100">
                                  {item.imageUrl ? (
                                    <div className="shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted/50">
                                      <img src={item.imageUrl} alt={item.name} className="h-16 w-16 object-cover" />
                                    </div>
                                  ) : (
                                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/50 text-muted-foreground">
                                      <ShoppingBag className="h-6 w-6 opacity-20" />
                                    </div>
                                  )}
                                  
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="text-sm font-semibold">{item.name || `Item ${iIdx + 1}`}</p>
                                      <div className="-mt-1.5 -mr-1.5 flex shrink-0 items-center gap-1">
                                        {item.price && (
                                          <span className="mr-2 rounded-md bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-500">
                                            {item.price}
                                          </span>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 hover:text-orange-500"
                                          onClick={() => handleEditItem(bIdx, sIdx, iIdx)}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() => handleRemoveItem(bIdx, sIdx, iIdx)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    {item.description && (
                                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {item.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <Button variant="outline" onClick={() => handleAddItem(bIdx, sIdx)}>
                              <Plus className="mr-2 h-4 w-4" />
                              Adicionar item
                            </Button>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleSave} disabled={saving} className="min-w-[160px]">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar vitrine'}
          </Button>
        </CardFooter>
      </Card>

      {/* Item Modal */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingItem?.isNew ? 'Adicionar item ao cardápio' : 'Editar item'}</DialogTitle>
            <DialogDescription>
              Configure o prato/item que aparecerá nesta seção.
            </DialogDescription>
          </DialogHeader>
          
          {editingItem && (
            <div className="grid gap-6 py-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="item-name">Nome do item</Label>
                    <Input
                      id="item-name"
                      placeholder="Ex: Hambúrguer Clássico"
                      value={editingItem.item.name}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, name: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-price">Preço</Label>
                    <Input
                      id="item-price"
                      placeholder="Ex: 35,90"
                      value={editingItem.item.price}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, price: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="item-image">URL da Foto</Label>
                    <Input
                      id="item-image"
                      placeholder="https://..."
                      value={editingItem.item.imageUrl || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, imageUrl: e.target.value } })}
                    />
                  </div>
                </div>
                
                {/* Photo Preview */}
                <div className="flex flex-col gap-2">
                  <Label>Preview</Label>
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-muted/30">
                    {editingItem.item.imageUrl ? (
                      <img src={editingItem.item.imageUrl} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-8 w-8 text-muted-foreground/30" />
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="item-desc">Descrição</Label>
                <Textarea
                  id="item-desc"
                  placeholder="Descreva os ingredientes, tamanho, etc."
                  className="min-h-[100px]"
                  value={editingItem.item.description}
                  onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, description: e.target.value } })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>Cancelar</Button>
            <Button onClick={handleSaveItemModal}>Salvar item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────── */

export default function DeliveryHubIntegrationPage() {
  const user = useCurrentUser();
  const { toast } = useToast();

  const [vitrines, setVitrines] = useState<DeliveryHubVitrine[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingVitrine, setEditingVitrine] = useState<DeliveryHubVitrine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeliveryHubVitrine | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadVitrines = useCallback(async () => {
    if (!user?.activeWorkspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await listVitrines(user.activeWorkspaceId);

    if (!result.success) {
      toast({ title: 'Erro', description: result.error || 'Erro ao carregar.', variant: 'destructive' });
    }

    setVitrines(result.vitrines);
    setLoading(false);
  }, [toast, user?.activeWorkspaceId]);

  useEffect(() => {
    void loadVitrines();
  }, [loadVitrines]);

  const handleCreate = async () => {
    if (!user?.activeWorkspaceId) return;
    setCreating(true);
    const result = await createVitrine(user.activeWorkspaceId);
    setCreating(false);

    if (!result.success || !result.vitrine) {
      toast({ title: 'Erro', description: result.error || 'Erro ao criar.', variant: 'destructive' });
      return;
    }

    setVitrines((prev) => [result.vitrine!, ...prev]);
    setEditingVitrine(result.vitrine);
    toast({ title: 'Vitrine criada', description: 'Configure e publique quando estiver pronta.' });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteVitrine(deleteTarget.id);
    setDeleting(false);

    if (!result.success) {
      toast({ title: 'Erro', description: result.error || 'Erro ao excluir.', variant: 'destructive' });
      return;
    }

    setVitrines((prev) => prev.filter((v) => v.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast({ title: 'Vitrine excluida', description: 'A vitrine foi removida.' });
  };

  const handleSaved = (updated: DeliveryHubVitrine) => {
    setVitrines((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    setEditingVitrine(updated);
  };

  /* ── Loading state ─── */
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user?.activeWorkspaceId) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace nao selecionado</AlertTitle>
          <AlertDescription>Selecione um workspace para configurar o Delivery Hub.</AlertDescription>
        </Alert>
      </div>
    );
  }

  /* ── Editing mode ─── */
  if (editingVitrine) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <VitrineEditor
          vitrine={editingVitrine}
          onSaved={handleSaved}
          onBack={() => setEditingVitrine(null)}
        />
      </div>
    );
  }

  /* ── List mode ─── */
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-orange-400">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-orange-400">Integracao</p>
              <h1 className="text-3xl font-bold tracking-tight">Delivery Hub</h1>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Crie multiplas vitrines com negocios independentes. Cada vitrine tem seu proprio link e cada card pode ser
            compartilhado individualmente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/integrations">
            <Button variant="outline">Voltar para integracoes</Button>
          </Link>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {creating ? 'Criando...' : 'Nova vitrine'}
          </Button>
        </div>
      </div>

      {/* Vitrines grid */}
      {vitrines.length === 0 ? (
        <Card className="border-border/70 bg-card/60">
          <CardContent className="py-16">
            <div className="mx-auto max-w-md text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 text-orange-400">
                <Store className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-xl font-semibold">Nenhuma vitrine criada</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Monte sua primeira vitrine com negocios, cardapios e um link compartilhavel unico.
              </p>
              <Button className="mt-6" onClick={handleCreate} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Criar primeira vitrine
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {vitrines.map((vitrine) => (
            <VitrineCard
              key={vitrine.id}
              vitrine={vitrine}
              onEdit={() => setEditingVitrine(vitrine)}
              onDelete={() => setDeleteTarget(vitrine)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir vitrine</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir &quot;{deleteTarget?.title || 'esta vitrine'}&quot;? O link publico deixara de funcionar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {deleting ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
