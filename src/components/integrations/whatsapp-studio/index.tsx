'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Copy,
  Eye,
  GalleryHorizontalEnd,
  HeartHandshake,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import type { EvolutionInstance } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  deleteWhatsappStudioDraft,
  getWhatsappStudioLibrary,
  getWhatsappStudioTemplates,
  publishWhatsappStudioTemplate,
  saveWhatsappStudioDraft,
  sendWhatsappStudioTest,
} from '@/actions/whatsapp-studio';
import {
  createStudioCard,
  createStudioDraft,
  getBodyVariables,
  importStudioBody,
  STUDIO_LANGUAGES,
  studioImageUrl,
  studioScrollBehavior,
  studioStarters,
  templateSlug,
  validateStudioDraft,
  type StudioButton,
  type StudioDraft,
  type StudioLibraryEntry,
  type StudioTemplate,
} from '@/lib/whatsapp/studio';
import {
  StudioButtonsEditor,
  StudioImageField,
  type ButtonLayoutChange,
} from './controls';
import { StudioPreview } from './preview';
import { MetaTemplateEditor } from './meta-template-editor';
import shared from '@/app/team/team-page.module.css';
import styles from './studio.module.css';

type Instance = Pick<
  EvolutionInstance,
  'id' | 'display_name' | 'instance_name' | 'type' | 'display_phone_number'
>;
const statusLabels: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Em análise',
  REJECTED: 'Precisa de ajustes',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
  IN_APPEAL: 'Em recurso',
  PENDING_DELETION: 'Em exclusão',
};
const categoryLabels: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
};
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const clone = <T,>(value: T): T => structuredClone(value);

function fromMeta(template: StudioTemplate): StudioDraft {
  const draft = createStudioDraft();
  draft.title = template.name.replace(/_/g, ' ').slice(0, 90) + ' · cópia';
  draft.templateName = templateSlug(draft.title) + '_' + uuidv4().slice(0, 8);
  draft.language = STUDIO_LANGUAGES.some(
    (language) => language.value === template.language,
  )
    ? (template.language as StudioDraft['language'])
    : 'pt_BR';
  draft.category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(
    template.category,
  )
    ? (template.category as StudioDraft['category'])
    : 'UTILITY';
  const body = template.components.find(
    (component) => component.type === 'BODY',
  );
  Object.assign(draft, importStudioBody(body));
  const convertButtons = (
    component?: Record<string, unknown>,
  ): StudioButton[] =>
    ((component?.buttons as Record<string, unknown>[] | undefined) || [])
      .slice(0, 3)
      .map((button) => ({
        id: uuidv4(),
        type:
          button.type === 'URL'
            ? 'url'
            : button.type === 'PHONE_NUMBER'
              ? 'phone'
              : 'reply',
        text: String(button.text || ''),
        value: String(button.url || button.phone_number || ''),
      }));
  const carousel = template.components.find(
    (component) => component.type === 'CAROUSEL',
  );
  if (carousel) {
    draft.kind = 'carousel';
    draft.category = 'MARKETING';
    draft.cards = (
      (carousel.cards as { components: Record<string, unknown>[] }[]) || []
    ).map((card) => {
      const copy = String(
        card.components.find((component) => component.type === 'BODY')?.text ||
          '',
      );
      const firstLine = copy.indexOf('\n');
      return {
        id: uuidv4(),
        title: firstLine >= 0 ? copy.slice(0, firstLine).slice(0, 80) : '',
        body: firstLine >= 0 ? copy.slice(firstLine + 1).trim() : copy,
        imageKey: '',
        buttons: convertButtons(
          card.components.find((component) => component.type === 'BUTTONS'),
        ).slice(0, 2),
      };
    });
  } else {
    const header = template.components.find(
      (component) => component.type === 'HEADER',
    );
    if (header?.format === 'TEXT') draft.header = String(header.text || '');
    draft.footer = String(
      template.components.find((component) => component.type === 'FOOTER')
        ?.text || '',
    );
    draft.buttons = convertButtons(
      template.components.find((component) => component.type === 'BUTTONS'),
    );
  }
  if (draft.category === 'AUTHENTICATION') draft.authenticationCode = '123456';
  return draft;
}

export function WhatsappStudio({
  workspaceId,
  instances,
  canManage,
  onConnect,
}: {
  workspaceId: string;
  instances: Instance[];
  canManage: boolean;
  onConnect: () => void;
}) {
  const { toast } = useToast();
  const [instanceId, setInstanceId] = useState('');
  const [entries, setEntries] = useState<StudioLibraryEntry[]>([]);
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [editing, setEditing] = useState<StudioLibraryEntry | null>(null);
  const [baseline, setBaseline] = useState('');
  const [step, setStep] = useState(1);
  const [activeCardId, setActiveCardId] = useState('');
  const [busy, setBusy] = useState<'save' | 'publish' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleting, setDeleting] = useState<StudioLibraryEntry | null>(null);
  const [testEntry, setTestEntry] = useState<StudioLibraryEntry | null>(null);
  const [recipient, setRecipient] = useState('');
  const [requestId, setRequestId] = useState('');
  const [testError, setTestError] = useState('');
  const [testAttempted, setTestAttempted] = useState(false);
  const [inspecting, setInspecting] = useState<StudioTemplate | null>(null);
  const [editingMeta, setEditingMeta] = useState<StudioTemplate | null>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const templateInstance = useRef('');
  const editorTop = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const instance = instances.find((item) => item.id === instanceId);
  const official = instance?.type === 'wa_cloud';
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const activeCard =
    draft?.cards.find((card) => card.id === activeCardId) || draft?.cards[0];
  const activeIndex =
    draft?.cards.findIndex((card) => card.id === activeCard?.id) ?? 0;
  const errors = draft ? validateStudioDraft(draft, official) : [];

  useEffect(() => {
    if (!instances.some((item) => item.id === instanceId))
      setInstanceId(instances[0]?.id || '');
  }, [instances, instanceId]);
  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getWhatsappStudioLibrary(workspaceId);
      setLoadError(result.success ? '' : result.error);
      if (result.success) setEntries(result.entries);
    } catch {
      setLoadError(
        'Não foi possível acessar a biblioteca. Confira sua conexão e tente atualizar novamente.',
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    if (!instanceId || !official) {
      setTemplates([]);
      setTemplateError('');
      return;
    }
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setTemplateLoading(true);
      try {
        const result = await getWhatsappStudioTemplates(
          workspaceId,
          instanceId,
        );
        if (!current) return;
        setTemplateError(
          result.success
            ? ''
            : result.error || 'Não foi possível atualizar a Meta.',
        );
        if (result.success) setTemplates(result.templates);
      } catch {
        if (current)
          setTemplateError(
            'Não foi possível consultar a Meta. Confira sua conexão e tente atualizar novamente.',
          );
      } finally {
        inFlight = false;
        if (current) setTemplateLoading(false);
      }
    }
    if (templateInstance.current !== instanceId) {
      setTemplates([]);
      templateInstance.current = instanceId;
    }
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [workspaceId, instanceId, official, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function openDraft(
    value: StudioDraft,
    entry: StudioLibraryEntry | null = null,
    initialStep = 2,
  ) {
    setDraft(clone(value));
    setEditing(entry);
    setBaseline(JSON.stringify(value));
    setStep(initialStep);
    setActiveCardId(value.cards[0]?.id || '');
    setError('');
    setTimeout(
      () =>
        editorTop.current?.scrollIntoView({
          behavior: studioScrollBehavior(),
          block: 'start',
        }),
      0,
    );
  }
  function start(kind: StudioDraft['kind'] = 'message') {
    const value = createStudioDraft(kind);
    value.title =
      kind === 'carousel' ? 'Meu novo carrossel' : 'Minha nova mensagem';
    value.templateName = templateSlug(value.title);
    openDraft(value, null, 1);
  }
  function update(patch: Partial<StudioDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setError('');
  }
  function updateTitle(title: string) {
    if (!draft) return;
    update({
      title,
      templateName:
        !draft.templateName || draft.templateName === templateSlug(draft.title)
          ? templateSlug(title)
          : draft.templateName,
    });
  }
  function duplicate(entry: StudioLibraryEntry) {
    const value = clone(entry.draft);
    value.title = entry.title.slice(0, 90) + ' · cópia';
    value.templateName =
      templateSlug(value.title) + '_' + Date.now().toString(36).slice(-4);
    openDraft(value);
  }
  function putEntry(entry: StudioLibraryEntry) {
    setEntries((current) => [
      entry,
      ...current.filter((item) => item.id !== entry.id),
    ]);
    setEditing(entry);
  }
  async function persist() {
    if (!draft || !instanceId)
      throw new Error('Escolha uma conexão para salvar.');
    if (editing && !dirty && editing.instance_id === instanceId) return editing;
    const result = await saveWhatsappStudioDraft({
      workspaceId,
      instanceId,
      draft,
      id: editing?.id,
      revision: editing?.revision,
    });
    if (!result.success) throw new Error(result.error);
    putEntry(result.entry);
    setBaseline(JSON.stringify(draft));
    return result.entry;
  }
  async function save(leave = false) {
    setBusy('save');
    setError('');
    try {
      await persist();
      toast({
        title: 'Criação salva na biblioteca',
        description: 'Você pode continuar de onde parou quando quiser.',
      });
      if (leave) {
        setDraft(null);
        setLeaveOpen(false);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Não foi possível salvar.',
      );
    } finally {
      setBusy(null);
    }
  }
  async function publish() {
    if (errors.length) {
      setError(errors[0]);
      setStep(3);
      return;
    }
    setBusy('publish');
    setError('');
    try {
      const entry = await persist();
      const result = await publishWhatsappStudioTemplate(
        workspaceId,
        entry.id,
        entry.revision,
      );
      if (!result.success) throw new Error(result.error);
      putEntry({
        ...entry,
        provider_name: result.name,
        publication_matches: true,
      });
      setRefresh((value) => value + 1);
      toast({
        title: 'Template enviado à Meta',
        description: 'O status de aprovação será atualizado na sua biblioteca.',
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar para aprovação.',
      );
    } finally {
      setBusy(null);
    }
  }
  async function prepareTest() {
    if (errors.length) {
      setStep(3);
      setError(errors[0]);
      return;
    }
    setBusy('save');
    setError('');
    try {
      const entry = await persist();
      setTestEntry(entry);
      setRecipient('');
      setRequestId(uuidv4());
      setTestError('');
      setTestAttempted(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o teste.',
      );
    } finally {
      setBusy(null);
    }
  }
  async function sendTest() {
    if (!testEntry) return;
    setBusy('send');
    setTestError('');
    setTestAttempted(true);
    try {
      const result = await sendWhatsappStudioTest({
        workspaceId,
        entryId: testEntry.id,
        revision: testEntry.revision,
        recipient,
        requestId,
      });
      if (!result.success) throw new Error(result.error);
      setTestEntry(null);
      toast({
        title: 'Teste aceito pelo WhatsApp',
        description: 'Confira a mensagem no número informado.',
      });
    } catch (error) {
      setTestError(
        error instanceof Error
          ? error.message
          : 'Não foi possível confirmar o teste.',
      );
    } finally {
      setBusy(null);
    }
  }
  function insertVariable(label: string, sample: string) {
    if (!draft) return;
    const position = Math.max(0, ...getBodyVariables(draft.body)) + 1;
    const token = '{{' + position + '}}';
    const start = bodyInput.current?.selectionStart ?? draft.body.length;
    const end = bodyInput.current?.selectionEnd ?? start;
    const body = draft.body.slice(0, start) + token + draft.body.slice(end);
    if (body.length > 1024) return;
    update({
      body,
      examples: { ...draft.examples, [position]: sample },
      variableLabels: { ...draft.variableLabels, [position]: label },
    });
    requestAnimationFrame(() => {
      bodyInput.current?.focus();
      bodyInput.current?.setSelectionRange(
        start + token.length,
        start + token.length,
      );
    });
  }
  function updateCard(patch: Partial<NonNullable<typeof activeCard>>) {
    if (!activeCard) return;
    const cardId = activeCard.id;
    // A photo upload can finish after the user has moved to another card.
    setDraft((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((card) =>
              card.id === cardId ? { ...card, ...patch } : card,
            ),
          }
        : current,
    );
    setError('');
  }
  function updateCardButtons(
    buttons: StudioButton[],
    layout?: ButtonLayoutChange,
  ) {
    if (!draft || !activeCard) return;
    update({
      cards: draft.cards.map((card) => {
        if (card.id === activeCard.id) return { ...card, buttons };
        if (!official || !layout) return card;
        const next = [...card.buttons];
        if (layout.type === 'remove') next.splice(layout.index, 1);
        if (layout.type === 'add')
          next.push({ ...buttons[layout.index], id: uuidv4() });
        if (layout.type === 'type' && next[layout.index])
          next[layout.index] = {
            ...next[layout.index],
            type: buttons[layout.index].type,
            value: '',
          };
        return { ...card, buttons: next };
      }),
    });
  }
  function moveCard(direction: -1 | 1) {
    if (
      !draft ||
      activeIndex + direction < 0 ||
      activeIndex + direction >= draft.cards.length
    )
      return;
    const cards = [...draft.cards];
    const [card] = cards.splice(activeIndex, 1);
    cards.splice(activeIndex + direction, 0, card);
    update({ cards });
  }
  function addCard(copy = false) {
    if (!draft || draft.cards.length >= 10) return;
    const id = uuidv4();
    const card =
      copy && activeCard
        ? {
            ...clone(activeCard),
            id,
            buttons: activeCard.buttons.map((button) => ({
              ...button,
              id: uuidv4(),
            })),
          }
        : createStudioCard(id);
    if (!copy && official && draft.cards[0])
      card.buttons = draft.cards[0].buttons.map((button) => ({
        ...button,
        value: '',
        id: uuidv4(),
      }));
    const cards = [...draft.cards];
    cards.splice(copy ? activeIndex + 1 : cards.length, 0, card);
    update({ cards });
    setActiveCardId(card.id);
  }
  const selectedEntries = entries.filter(
    (entry) =>
      (!entry.instance_id || entry.instance_id === instanceId) &&
      (filter === 'all' || entry.draft.kind === filter) &&
      (!search ||
        normalized(
          entry.title + ' ' + entry.draft.body + ' ' + entry.draft.templateName,
        ).includes(normalized(search))) &&
      (statusFilter === 'all' ||
        (entry.publication_matches !== false &&
          templates.find(
            (template) =>
              template.name === entry.provider_name &&
              template.language === entry.draft.language,
          )?.status === statusFilter)),
  );
  const externalTemplates = templates.filter(
    (template) =>
      !entries.some(
        (entry) =>
          entry.instance_id === instanceId &&
          entry.publication_matches !== false &&
          entry.provider_name === template.name &&
          entry.draft.language === template.language,
      ) &&
      (filter === 'all' ||
        (template.components.some((component) => component.type === 'CAROUSEL')
          ? 'carousel'
          : 'message') === filter) &&
      (statusFilter === 'all' || template.status === statusFilter) &&
      normalized(template.name).includes(normalized(search)),
  );
  const currentTemplate =
    editing?.provider_name && editing.publication_matches !== false
      ? templates.find(
          (template) =>
            template.name === editing.provider_name &&
            template.language === draft?.language,
        )
      : undefined;

  return (
    <section className={styles.studio} aria-label="Estúdio de mensagens">
      {!draft ? (
        <>
          <div className={styles.libraryIntro}>
            <div>
              <span className={shared.eyebrow}>
                MENOS TRABALHO. MAIS CONVERSA.
              </span>
              <h2>
                Boas mensagens merecem
                <br />
                um lugar para nascer<span className={shared.titleDot}>.</span>
              </h2>
              <p>
                Crie uma vez. Personalize com carinho. Use sempre que precisar.
              </p>
            </div>
            <Button
              disabled={!canManage || !instanceId}
              className={styles.primaryButton}
              onClick={() => start()}
            >
              <Plus size={16} /> Criar mensagem <ArrowUpRight size={15} />
            </Button>
          </div>
          {!instances.length ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>
                <MessageCircle size={27} />
              </span>
              <h3>Primeiro, vamos conectar seu WhatsApp</h3>
              <p>
                Sua biblioteca e o estúdio ficam prontos para usar assim que
                você adicionar uma conexão.
              </p>
              {canManage && (
                <Button onClick={onConnect}>
                  Conectar meu número <ArrowRight size={15} />
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={styles.starterGrid}>
                {studioStarters.map((starter, index) => (
                  <button
                    type="button"
                    key={starter.id}
                    className={styles.starter}
                    disabled={!canManage}
                    onClick={() => {
                      const value = createStudioDraft(starter.kind);
                      value.title = starter.title;
                      value.templateName = templateSlug(value.title);
                      value.body = starter.body;
                      value.examples = { ...starter.examples };
                      value.category = starter.category;
                      if (starter.id === 'order')
                        value.variableLabels = {
                          '1': 'Nome da pessoa',
                          '2': 'Número do pedido',
                        };
                      if (starter.id === 'appointment')
                        value.variableLabels = {
                          '1': 'Nome da pessoa',
                          '2': 'Data e horário',
                        };
                      openDraft(value);
                    }}
                  >
                    <span
                      className={cn(
                        styles.starterIcon,
                        index === 1 && styles.warmIcon,
                      )}
                    >
                      {index === 0 ? (
                        <PackageCheck size={22} />
                      ) : index === 1 ? (
                        <HeartHandshake size={23} />
                      ) : (
                        <GalleryHorizontalEnd size={22} />
                      )}
                    </span>
                    <span>
                      <strong>{starter.title}</strong>
                      <small>{starter.description}</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              <div className={styles.libraryHeading}>
                <div>
                  <BookOpen size={19} />
                  <h3>Sua biblioteca</h3>
                  <span className={styles.count}>
                    {
                      entries.filter(
                        (entry) =>
                          entry.instance_id === instanceId ||
                          !entry.instance_id,
                      ).length
                    }
                  </span>
                </div>
                <div className={styles.connectionPicker}>
                  <Label htmlFor="studio-connection">
                    Criar e gerenciar com
                  </Label>
                  <Select value={instanceId} onValueChange={setInstanceId}>
                    <SelectTrigger id="studio-connection">
                      <SelectValue placeholder="Escolha uma conexão" />
                    </SelectTrigger>
                    <SelectContent className={shared.surface}>
                      {instances.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.display_name} ·{' '}
                          {item.type === 'wa_cloud' ? 'Oficial' : 'QR Code'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className={styles.libraryToolbar}>
                <div
                  className={styles.formatFilters}
                  role="group"
                  aria-label="Filtrar formato"
                >
                  {[
                    { value: 'all', label: 'Todas' },
                    { value: 'message', label: 'Mensagens' },
                    { value: 'carousel', label: 'Carrosséis' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      aria-pressed={filter === item.value}
                      onClick={() => setFilter(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className={styles.search}>
                  <Search size={15} />
                  <Input
                    aria-label="Pesquisar na biblioteca"
                    value={search}
                    placeholder="Encontre uma criação…"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                {official && (
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger
                      aria-label="Filtrar status na Meta"
                      className={styles.statusSelect}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={shared.surface}>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="APPROVED">Aprovados</SelectItem>
                      <SelectItem value="PENDING">Em análise</SelectItem>
                      <SelectItem value="REJECTED">
                        Precisam de ajustes
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Atualizar biblioteca e status"
                  disabled={loading || templateLoading}
                  onClick={() => {
                    void loadLibrary();
                    setRefresh((value) => value + 1);
                  }}
                >
                  <RefreshCw
                    size={15}
                    className={cn(
                      (loading || templateLoading) && 'animate-spin',
                    )}
                  />
                </Button>
              </div>
              {loadError && (
                <div className={styles.errorBanner} role="alert">
                  <AlertCircle size={17} />
                  <p>{loadError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadLibrary()}
                  >
                    Tentar novamente
                  </Button>
                </div>
              )}
              {templateError && (
                <div className={styles.errorBanner} role="alert">
                  <AlertCircle size={17} />
                  <p>{templateError} Seus rascunhos continuam disponíveis.</p>
                </div>
              )}
              {!canManage && (
                <p className={styles.accessNote}>
                  <LockKeyhole size={14} /> Você pode consultar a biblioteca.
                  Para criar ou alterar mensagens, solicite acesso ao
                  administrador.
                </p>
              )}
              {loading && !entries.length ? (
                <div className={styles.emptyState} role="status">
                  <Loader2 className="animate-spin" size={23} />
                  <p>Carregando suas criações…</p>
                </div>
              ) : (
                <div className={styles.libraryGrid}>
                  {selectedEntries.map((entry) => {
                    const registered =
                      entry.publication_matches === false
                        ? undefined
                        : templates.find(
                            (template) =>
                              template.name === entry.provider_name &&
                              template.language === entry.draft.language,
                          );
                    const complete =
                      validateStudioDraft(entry.draft, official).length === 0;
                    return (
                      <article key={entry.id} className={styles.libraryCard}>
                        <div className={styles.libraryCardTop}>
                          <span className={styles.formatBadge}>
                            {entry.draft.kind === 'carousel' ? (
                              <GalleryHorizontalEnd size={13} />
                            ) : (
                              <MessageCircle size={13} />
                            )}
                            {entry.draft.kind === 'carousel'
                              ? entry.draft.cards.length + ' cartões'
                              : 'Mensagem'}
                          </span>
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={'Ações de ' + entry.title}
                                >
                                  <MoreHorizontal size={17} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className={shared.surface}
                              >
                                <DropdownMenuItem
                                  onClick={() => openDraft(entry.draft, entry)}
                                >
                                  Continuar editando
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => duplicate(entry)}
                                >
                                  <Copy size={14} className="mr-2" />
                                  Criar uma cópia
                                </DropdownMenuItem>
                                {entry.provider_name && templates.find(template => template.name === entry.provider_name && template.language === entry.draft.language) && <DropdownMenuItem onClick={() => setEditingMeta(templates.find(template => template.name === entry.provider_name && template.language === entry.draft.language) || null)}><PencilLine size={14} className="mr-2" />Editar na Meta</DropdownMenuItem>}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleting(entry)}
                                  className="text-destructive"
                                >
                                  <Trash2 size={14} className="mr-2" />
                                  Excluir da biblioteca
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        <div className={styles.libraryCardPreview}>
                          {entry.draft.kind === 'carousel' ? (
                            <div className={styles.miniCarousel}>
                              {entry.draft.cards
                                .slice(0, 3)
                                .map((card, index) => (
                                  <div key={card.id}>
                                    {card.imageKey ? (
                                      <Image
                                        src={studioImageUrl(card.imageKey)}
                                        alt={
                                          card.title ||
                                          'Foto do cartão ' + (index + 1)
                                        }
                                        width={170}
                                        height={120}
                                        unoptimized
                                      />
                                    ) : (
                                      <ImagePlus size={21} />
                                    )}
                                    <span>
                                      {card.title || 'Cartão ' + (index + 1)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className={styles.miniMessage}>
                              <MessageCircle size={17} />
                              <p>
                                {entry.draft.category === 'AUTHENTICATION'
                                  ? 'Seu código de verificação, com segurança e praticidade.'
                                  : entry.draft.body ||
                                    'Uma ideia esperando suas palavras.'}
                              </p>
                            </div>
                          )}
                        </div>
                        <div className={styles.libraryCardCopy}>
                          <h4>{entry.title}</h4>
                          <p>
                            {new Date(entry.updated_at).toLocaleDateString(
                              'pt-BR',
                              { day: '2-digit', month: 'short' },
                            )}{' '}
                            · {categoryLabels[entry.draft.category]}
                          </p>
                        </div>
                        <div className={styles.libraryCardFooter}>
                          <span
                            className={styles.statusBadge}
                            data-status={registered?.status || 'DRAFT'}
                          >
                            {registered?.status === 'APPROVED' ? (
                              <CheckCircle2 size={12} />
                            ) : (
                              <span />
                            )}
                            {registered
                              ? statusLabels[registered.status] ||
                                'Status indisponível'
                              : entry.provider_name
                                ? entry.publication_matches === false
                                  ? 'Alterações em rascunho'
                                  : 'Enviado à Meta'
                                : complete && !official
                                  ? 'Pronto para usar'
                                  : 'Rascunho'}
                          </span>
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => openDraft(entry.draft, entry)}
                          >
                            {canManage ? 'Abrir criação' : 'Ver criação'}{' '}
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {canManage && !loadError && (
                    <button
                      type="button"
                      className={styles.newCreationCard}
                      onClick={() => start('carousel')}
                    >
                      <span>
                        <Plus size={24} />
                      </span>
                      <strong>Uma ideia cabe em vários cartões</strong>
                      <p>Monte um carrossel do seu jeito.</p>
                      <small>
                        Criar carrossel <ArrowRight size={13} />
                      </small>
                    </button>
                  )}
                </div>
              )}
              {!selectedEntries.length &&
                (search || filter !== 'all' || statusFilter !== 'all') && (
                  <p className={styles.noResults}>
                    Nenhuma criação encontrada com estes filtros.
                  </p>
                )}
              {official && (
                <div className={styles.metaLibrary}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <ShieldCheck size={18} />
                      <h3>Da sua conta Meta</h3>
                    </div>
                    <span>
                      {templateError
                        ? 'Consulta indisponível'
                        : templateLoading && !templates.length
                          ? 'Consultando a conta…'
                          : templates.length +
                            (templates.length === 1
                              ? ' template'
                              : ' templates') +
                            ' · status atualiza automaticamente'}
                    </span>
                  </div>
                  {templateLoading && !templates.length ? (
                    <p className={styles.accessNote}>
                      <Loader2 size={14} className="animate-spin" /> Consultando
                      a Meta…
                    </p>
                  ) : externalTemplates.length ? (
                    <div className={styles.metaTemplateGrid}>
                      {externalTemplates.map((template) => (
                        <article
                          className={styles.metaTemplate}
                          key={template.name + template.language}
                        >
                          <div>
                            <span
                              className={styles.statusBadge}
                              data-status={template.status}
                            >
                              {statusLabels[template.status] ||
                                'Status indisponível'}
                            </span>
                            <span>{template.language.replace('_', '-')}</span>
                          </div>
                          <h4>{template.name.replace(/_/g, ' ')}</h4>
                          <p>
                            {String(
                              template.components.find(
                                (component) => component.type === 'BODY',
                              )?.text || 'Template de autenticação',
                            )}
                          </p>
                          <div className={styles.metaTemplateActions}>
                            {canManage && (
                              <button type="button" className={styles.textButton} onClick={() => setEditingMeta(template)}>
                                <PencilLine size={14} /> Editar template
                              </button>
                            )}
                            <button type="button" className={styles.textButton} onClick={() => setInspecting(template)}>
                              Ver detalhes <ArrowUpRight size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.accessNote}>
                      {templates.length
                        ? 'Os templates desta conexão estão organizados na biblioteca acima ou fora dos filtros selecionados.'
                        : templateError
                          ? 'Atualize a consulta para carregar os templates desta conta.'
                          : 'Nenhum template encontrado nesta conta. Você pode criar seu primeiro modelo no estúdio.'}
                    </p>
                  )}
                </div>
              )}
              <div className={styles.libraryNote}>
                <CircleHelp size={17} />
                <div>
                  <strong>
                    {official
                      ? 'Uma criação, duas etapas'
                      : 'Sua criatividade, sem a etapa de aprovação'}
                  </strong>
                  <p>
                    {official
                      ? 'Salve à vontade. Quando estiver pronto, envie para a Meta e acompanhe a aprovação por aqui. Carrosséis oficiais usam a categoria Marketing.'
                      : 'Na conexão por QR Code, suas mensagens e carrosséis ficam na biblioteca e podem ser testados diretamente. A exibição depende do suporte do WhatsApp de quem recebe.'}
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div ref={editorTop} className={styles.editor}>
          <div className={styles.editorTop}>
            <button
              type="button"
              disabled={Boolean(busy)}
              className={styles.backButton}
              onClick={() => (dirty ? setLeaveOpen(true) : setDraft(null))}
            >
              <ArrowLeft size={16} /> Biblioteca
            </button>
            <span className={styles.saveStatus}>
              {busy === 'save' ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Salvando…
                </>
              ) : dirty || !editing ? (
                <>
                  <span /> Alterações não salvas
                </>
              ) : (
                <>
                  <Check size={13} /> Salvo na biblioteca
                </>
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !canManage || Boolean(busy) || (!dirty && Boolean(editing))
              }
              onClick={() => void save()}
            >
              <Save size={14} /> Salvar rascunho
            </Button>
          </div>
          <div className={styles.editorHeading}>
            <div>
              <span className={shared.eyebrow}>ESTÚDIO DE MENSAGENS</span>
              <h2>
                {draft.title || 'Sua próxima boa mensagem'}
                <span className={shared.titleDot}>.</span>
              </h2>
              <p>
                {official
                  ? 'Sua criação ganha forma aqui. A aprovação acontece na Meta.'
                  : 'Crie, experimente e encontre o seu jeito de conversar.'}
              </p>
            </div>
            <span className={styles.connectionBadge}>
              {official ? (
                <ShieldCheck size={14} />
              ) : (
                <MessageCircle size={14} />
              )}
              {instance?.display_name} · {official ? 'Oficial' : 'QR Code'}
            </span>
          </div>
          <nav className={styles.steps} aria-label="Etapas da criação">
            {['A ideia', 'Dê vida', 'Tudo pronto'].map((label, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index + 1 ? 'step' : undefined}
                disabled={Boolean(busy)}
                onClick={() => {
                  setStep(index + 1);
                  setError('');
                }}
              >
                <span>
                  {step > index + 1 ? <Check size={13} /> : index + 1}
                </span>
                <strong>{label}</strong>
                {index < 2 && <ChevronRight size={15} />}
              </button>
            ))}
            <button
              type="button"
              className={styles.mobilePreviewButton}
              onClick={() =>
                preview.current?.scrollIntoView({
                  behavior: studioScrollBehavior(),
                  block: 'start',
                })
              }
            >
              <Eye size={15} /> Prévia
            </button>
          </nav>
          <div className={styles.workbench}>
            <div className={styles.editingPanel}>
              {editing?.provider_name && (
                <div className={styles.publishedNote}>
                  <ShieldCheck size={17} />
                  <p>
                    Esta criação já foi enviada à Meta
                    {currentTemplate
                      ? ': ' +
                        (
                          statusLabels[currentTemplate.status] ||
                          currentTemplate.status
                        ).toLowerCase()
                      : ''}
                    . Para mudar o conteúdo aprovado, crie uma cópia com um novo
                    nome.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy) || !canManage}
                    onClick={() =>
                      duplicate({ ...editing, draft, title: draft.title })
                    }
                  >
                    <Copy size={13} /> Criar cópia
                  </Button>
                </div>
              )}
              <fieldset
                disabled={Boolean(busy) || !canManage}
                className={styles.editorFields}
              >
                {step === 1 && (
                  <div className={styles.stepContent} key="idea">
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionNumber}>01</span>
                      <div>
                        <h3>Toda conversa começa com uma ideia</h3>
                        <p>Escolha como você quer se aproximar.</p>
                      </div>
                    </div>
                    <div className={styles.formatChoices}>
                      {[
                        {
                          kind: 'message' as const,
                          label: 'Uma mensagem',
                          description:
                            'Texto, foto e um convite para continuar.',
                          icon: MessageCircle,
                        },
                        {
                          kind: 'carousel' as const,
                          label: 'Um carrossel',
                          description: 'De 2 a 10 cartões para explorar.',
                          icon: GalleryHorizontalEnd,
                        },
                      ].map((item) => (
                        <button
                          type="button"
                          key={item.kind}
                          aria-pressed={draft.kind === item.kind}
                          onClick={() =>
                            update({
                              kind: item.kind,
                              category:
                                item.kind === 'carousel'
                                  ? 'MARKETING'
                                  : draft.category,
                              cards:
                                item.kind === 'carousel' && !draft.cards.length
                                  ? createStudioDraft('carousel').cards
                                  : draft.cards,
                            })
                          }
                        >
                          <item.icon size={24} strokeWidth={1.5} />
                          <strong>{item.label}</strong>
                          <span>{item.description}</span>
                          <span className={styles.choiceCheck}>
                            {draft.kind === item.kind && <Check size={12} />}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className={styles.field}>
                      <Label htmlFor="studio-title">
                        Como vamos chamar esta criação?
                      </Label>
                      <Input
                        id="studio-title"
                        maxLength={100}
                        value={draft.title}
                        onChange={(event) => updateTitle(event.target.value)}
                        placeholder="Ex.: Coleção de primavera"
                      />
                      <p className={styles.hint}>
                        Este nome organiza sua biblioteca. Ele não aparece para
                        o cliente.
                      </p>
                    </div>
                    <div className={styles.twoFields}>
                      <div className={styles.field}>
                        <Label htmlFor="studio-language">
                          Idioma da mensagem
                        </Label>
                        <Select
                          value={draft.language}
                          onValueChange={(value) =>
                            update({
                              language: value as StudioDraft['language'],
                            })
                          }
                        >
                          <SelectTrigger id="studio-language">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={shared.surface}>
                            {STUDIO_LANGUAGES.map((language) => (
                              <SelectItem
                                value={language.value}
                                key={language.value}
                              >
                                {language.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className={styles.field}>
                        <Label htmlFor="studio-category">
                          Qual é o objetivo?
                        </Label>
                        <Select
                          value={draft.category}
                          disabled={draft.kind === 'carousel'}
                          onValueChange={(value) =>
                            update(
                              value === 'AUTHENTICATION'
                                ? { category: 'AUTHENTICATION' }
                                : {
                                    category: value as StudioDraft['category'],
                                  },
                            )
                          }
                        >
                          <SelectTrigger id="studio-category">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={shared.surface}>
                            <SelectItem value="UTILITY">
                              Atualizar ou lembrar
                            </SelectItem>
                            <SelectItem value="MARKETING">
                              Apresentar e encantar
                            </SelectItem>
                            {official && (
                              <SelectItem value="AUTHENTICATION">
                                Enviar um código de acesso
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {draft.kind === 'carousel' && (
                      <div className={styles.tip}>
                        <Sparkles size={17} />
                        <p>
                          Mostre produtos, apresente serviços, compare planos ou
                          conte uma história. Cada cartão pode abrir uma nova
                          possibilidade.
                          {official &&
                            ' Na conexão oficial, o carrossel é um template de Marketing.'}
                        </p>
                      </div>
                    )}
                    {official && (
                      <details className={styles.advanced}>
                        <summary>
                          Nome de registro na Meta{' '}
                          <span>Opcional: ajustar</span>
                        </summary>
                        <div>
                          <Label htmlFor="studio-template-name">
                            Identificador do template
                          </Label>
                          <Input
                            id="studio-template-name"
                            value={draft.templateName}
                            maxLength={512}
                            onChange={(event) =>
                              update({ templateName: event.target.value })
                            }
                          />
                          <p className={styles.hint}>
                            Criamos automaticamente. Use letras minúsculas,
                            números e sublinhados.
                          </p>
                        </div>
                      </details>
                    )}
                  </div>
                )}
                {step === 2 && (
                  <div className={styles.stepContent} key="create">
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionNumber}>02</span>
                      <div>
                        <h3>
                          {draft.kind === 'carousel'
                            ? 'Uma história, cartão por cartão'
                            : 'As palavras certas, do seu jeito'}
                        </h3>
                        <p>
                          {draft.kind === 'carousel'
                            ? 'Comece com um convite. Depois, capriche nos detalhes.'
                            : 'Escreva como quem está do outro lado gostaria de ler.'}
                        </p>
                      </div>
                    </div>
                    {draft.category === 'AUTHENTICATION' ? (
                      <div className={styles.otpFields}>
                        <span className={styles.emptyIcon}>
                          <LockKeyhole size={26} />
                        </span>
                        <h4>Segurança que também é simples</h4>
                        <p>
                          O WhatsApp define o texto do código de acesso e inclui
                          a recomendação de segurança. Seu template terá um
                          botão para copiar o código e validade informada de 10
                          minutos.
                        </p>
                        <Label htmlFor="otp-example">
                          Um código de exemplo para a prévia e o teste
                        </Label>
                        <Input
                          id="otp-example"
                          maxLength={15}
                          value={draft.authenticationCode ?? '123456'}
                          onChange={(event) =>
                            update({ authenticationCode: event.target.value })
                          }
                        />
                      </div>
                    ) : (
                      <>
                        <div className={styles.field}>
                          <div className={styles.fieldHeading}>
                            <Label htmlFor="studio-body">
                              {draft.kind === 'carousel'
                                ? 'O convite para deslizar'
                                : 'Sua mensagem'}
                            </Label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" type="button">
                                  <WandSparkles size={13} /> Personalizar
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className={shared.surface}
                              >
                                {[
                                  { label: 'Nome da pessoa', sample: 'Marina' },
                                  {
                                    label: 'Número do pedido',
                                    sample: '12345',
                                  },
                                  {
                                    label: 'Data e horário',
                                    sample: 'amanhã, às 14h',
                                  },
                                  { label: 'Valor', sample: 'R$ 149,90' },
                                  { label: 'Outro campo', sample: '' },
                                ].map((field) => (
                                  <DropdownMenuItem
                                    key={field.label}
                                    onSelect={() =>
                                      insertVariable(field.label, field.sample)
                                    }
                                  >
                                    {field.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <Textarea
                            id="studio-body"
                            ref={bodyInput}
                            value={draft.body}
                            maxLength={1024}
                            rows={5}
                            onChange={(event) =>
                              update({ body: event.target.value })
                            }
                            placeholder={
                              draft.kind === 'carousel'
                                ? 'Ex.: Selecionamos algumas novidades que têm tudo a ver com você. Deslize para conhecer!'
                                : 'Olá! Que bom ter você por aqui…'
                            }
                          />
                          <div className={styles.fieldMeta}>
                            <span>
                              Use “Personalizar” para incluir nome, pedido ou
                              outros dados.
                            </span>
                            <span>{draft.body.length}/1024</span>
                          </div>
                        </div>
                        {getBodyVariables(draft.body).length > 0 && (
                          <div className={styles.variableFields}>
                            <div>
                              <WandSparkles size={16} />
                              <strong>Um exemplo deixa tudo mais claro</strong>
                            </div>
                            <p>
                              Estes exemplos aparecem na prévia e no teste
                              {official
                                ? ' e ajudam a Meta a analisar seu template'
                                : ''}
                              .
                            </p>
                            <div>
                              {getBodyVariables(draft.body).map((position) => (
                                <div key={position}>
                                  <Label htmlFor={'variable-' + position}>
                                    {draft.variableLabels[String(position)] ||
                                      'Personalização ' + position}
                                  </Label>
                                  <Input
                                    id={'variable-' + position}
                                    value={
                                      draft.examples[String(position)] || ''
                                    }
                                    maxLength={100}
                                    placeholder="Digite um exemplo"
                                    onChange={(event) =>
                                      update({
                                        examples: {
                                          ...draft.examples,
                                          [position]: event.target.value,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {draft.kind === 'carousel' && activeCard ? (
                          <div className={styles.cardWorkshop}>
                            <div className={styles.cardWorkshopHeading}>
                              <div>
                                <GalleryHorizontalEnd size={18} />
                                <h4>Seus cartões</h4>
                                <span>{draft.cards.length}/10</span>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={draft.cards.length >= 10}
                                onClick={() => addCard()}
                              >
                                <Plus size={13} /> Novo cartão
                              </Button>
                            </div>
                            <div
                              className={styles.cardTimeline}
                              role="group"
                              aria-label="Escolher cartão para editar"
                            >
                              {draft.cards.map((card, index) => (
                                <button
                                  type="button"
                                  key={card.id}
                                  aria-label={'Editar cartão ' + (index + 1)}
                                  aria-pressed={card.id === activeCard.id}
                                  onClick={() => setActiveCardId(card.id)}
                                >
                                  {card.imageKey ? (
                                    <Image
                                      src={studioImageUrl(card.imageKey)}
                                      alt=""
                                      width={84}
                                      height={56}
                                      unoptimized
                                    />
                                  ) : (
                                    <ImagePlus size={19} />
                                  )}
                                  <span>
                                    {String(index + 1).padStart(2, '0')}
                                  </span>
                                  {card.id === activeCard.id && (
                                    <Check size={11} />
                                  )}
                                </button>
                              ))}
                            </div>
                            <div
                              className={styles.cardEditor}
                              key={activeCard.id}
                            >
                              <div className={styles.cardEditorHeader}>
                                <span>
                                  CARTÃO{' '}
                                  {String(activeIndex + 1).padStart(2, '0')}
                                </span>
                                <div>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Mover cartão para antes"
                                    disabled={activeIndex === 0}
                                    onClick={() => moveCard(-1)}
                                  >
                                    <ArrowLeft size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Mover cartão para depois"
                                    disabled={
                                      activeIndex === draft.cards.length - 1
                                    }
                                    onClick={() => moveCard(1)}
                                  >
                                    <ArrowRight size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Duplicar cartão"
                                    disabled={draft.cards.length >= 10}
                                    onClick={() => addCard(true)}
                                  >
                                    <Copy size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Remover cartão"
                                    disabled={draft.cards.length <= 2}
                                    onClick={() => {
                                      update({
                                        cards: draft.cards.filter(
                                          (card) => card.id !== activeCard.id,
                                        ),
                                      });
                                      setActiveCardId(
                                        draft.cards[activeIndex - 1]?.id ||
                                          draft.cards[1]?.id ||
                                          '',
                                      );
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              </div>
                              <StudioImageField
                                workspaceId={workspaceId}
                                imageKey={activeCard.imageKey}
                                onChange={(imageKey) =>
                                  updateCard({ imageKey })
                                }
                                label={'Foto do cartão ' + (activeIndex + 1)}
                              />
                              <div className={styles.field}>
                                <Label htmlFor="card-title">
                                  Um título que desperta interesse
                                </Label>
                                <Input
                                  id="card-title"
                                  value={activeCard.title}
                                  maxLength={80}
                                  placeholder="Ex.: Seu novo favorito"
                                  onChange={(event) =>
                                    updateCard({ title: event.target.value })
                                  }
                                />
                              </div>
                              <div className={styles.field}>
                                <Label htmlFor="card-body">
                                  O que faz esta opção ser especial?
                                </Label>
                                <Textarea
                                  id="card-body"
                                  rows={3}
                                  value={activeCard.body}
                                  maxLength={official ? 160 : 900}
                                  placeholder="Descreva o benefício, inclua o preço ou conte um detalhe que vale conhecer."
                                  onChange={(event) =>
                                    updateCard({ body: event.target.value })
                                  }
                                />
                                <div className={styles.fieldMeta}>
                                  <span>
                                    {official
                                      ? 'Título e descrição juntos: até 160 caracteres.'
                                      : 'Uma descrição curta ajuda a decidir.'}
                                  </span>
                                  <span
                                    className={cn(
                                      official &&
                                        activeCard.title.length +
                                          activeCard.body.length +
                                          1 >
                                          160 &&
                                        styles.overLimit,
                                    )}
                                  >
                                    {activeCard.title.length +
                                      activeCard.body.length +
                                      1}
                                    /{official ? 160 : 981}
                                  </span>
                                </div>
                              </div>
                              <StudioButtonsEditor
                                buttons={activeCard.buttons}
                                onChange={updateCardButtons}
                                max={official ? 2 : 3}
                                shared={official}
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <details className={styles.optionalSection}>
                              <summary>
                                <ImagePlus size={16} /> Uma foto ou um título no
                                começo <span>Opcional</span>
                              </summary>
                              <div>
                                <StudioImageField
                                  workspaceId={workspaceId}
                                  imageKey={draft.headerImageKey}
                                  onChange={(headerImageKey) =>
                                    update({
                                      headerImageKey,
                                      header: headerImageKey
                                        ? ''
                                        : draft.header,
                                    })
                                  }
                                  label="Foto do cabeçalho"
                                />
                                {!draft.headerImageKey && (
                                  <div className={styles.field}>
                                    <Label htmlFor="message-header">
                                      Ou escreva um título
                                    </Label>
                                    <Input
                                      id="message-header"
                                      maxLength={60}
                                      value={draft.header}
                                      onChange={(event) =>
                                        update({ header: event.target.value })
                                      }
                                      placeholder="Ex.: Seu pedido está a caminho"
                                    />
                                  </div>
                                )}
                              </div>
                            </details>
                            <StudioButtonsEditor
                              buttons={draft.buttons}
                              onChange={(buttons) => update({ buttons })}
                            />
                            <div className={styles.field}>
                              <Label htmlFor="message-footer">
                                Uma assinatura ou observação{' '}
                                <span className={styles.optionalLabel}>
                                  Opcional
                                </span>
                              </Label>
                              <Input
                                id="message-footer"
                                maxLength={60}
                                value={draft.footer}
                                onChange={(event) =>
                                  update({ footer: event.target.value })
                                }
                                placeholder="Ex.: Com carinho, equipe Dialogy"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
                {step === 3 && (
                  <div className={styles.stepContent} key="review">
                    <div className={styles.sectionTitle}>
                      <span className={styles.sectionNumber}>03</span>
                      <div>
                        <h3>
                          {errors.length
                            ? 'Mais um carinho antes de continuar'
                            : 'Sua próxima conversa está pronta'}
                        </h3>
                        <p>
                          {errors.length
                            ? 'Revise estes detalhes. Sua criação já está quase lá.'
                            : 'Confira a prévia, salve na biblioteca e escolha o próximo passo.'}
                        </p>
                      </div>
                    </div>
                    <div
                      className={styles.reviewState}
                      data-ready={!errors.length}
                    >
                      {errors.length ? (
                        <AlertCircle size={26} />
                      ) : (
                        <CheckCircle2 size={28} />
                      )}
                      <div>
                        <strong>
                          {errors.length
                            ? errors.length +
                              (errors.length === 1
                                ? ' detalhe para ajustar'
                                : ' detalhes para ajustar')
                            : 'Tudo conferido'}
                        </strong>
                        <p>
                          {errors.length
                            ? 'Volte à edição para completar sua mensagem.'
                            : draft.kind === 'carousel'
                              ? draft.cards.length +
                                ' cartões, com fotos e botões prontos para encantar.'
                              : 'Texto, personalizações e botões revisados.'}
                        </p>
                      </div>
                    </div>
                    {errors.length > 0 && (
                      <ul className={styles.reviewErrors}>
                        {errors.map((message) => (
                          <li key={message}>
                            <span />
                            {message}
                          </li>
                        ))}
                      </ul>
                    )}
                    <dl className={styles.reviewDetails}>
                      <div>
                        <dt>Conexão</dt>
                        <dd>{instance?.display_name}</dd>
                      </div>
                      <div>
                        <dt>Formato</dt>
                        <dd>
                          {draft.kind === 'carousel'
                            ? 'Carrossel · ' + draft.cards.length + ' cartões'
                            : 'Mensagem'}
                        </dd>
                      </div>
                      <div>
                        <dt>Idioma</dt>
                        <dd>
                          {
                            STUDIO_LANGUAGES.find(
                              (language) => language.value === draft.language,
                            )?.label
                          }
                        </dd>
                      </div>
                      {official && (
                        <div>
                          <dt>Categoria na Meta</dt>
                          <dd>{categoryLabels[draft.category]}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Próximo passo</dt>
                        <dd>
                          {official
                            ? 'Enviar para aprovação da Meta'
                            : 'Salvar e enviar um teste'}
                        </dd>
                      </div>
                    </dl>
                    <div className={styles.tip}>
                      <ShieldCheck size={18} />
                      <p>
                        {official
                          ? 'A Meta define a aprovação e pode reclassificar o template. Depois de aprovado, você poderá testar o envio. A cobrança segue as regras da sua conta WhatsApp Business.'
                          : 'O teste envia uma mensagem real pelo número selecionado. Use seu próprio WhatsApp ou um contato que aceitou receber o teste.'}
                      </p>
                    </div>
                    {errors.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep(2)}
                      >
                        <ArrowLeft size={14} /> Voltar à edição
                      </Button>
                    )}
                  </div>
                )}
              </fieldset>
              {error && (
                <p className={styles.editorError} role="alert">
                  <AlertCircle size={16} />
                  {error}
                </p>
              )}
              <div className={styles.editorFooter}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={Boolean(busy) || step === 1}
                  onClick={() => setStep((value) => value - 1)}
                >
                  <ArrowLeft size={14} /> Voltar
                </Button>
                <span>{step} de 3</span>
                {step < 3 ? (
                  <Button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setStep((value) => value + 1)}
                  >
                    {step === 1 ? 'Dar vida à ideia' : 'Revisar criação'}{' '}
                    <ArrowRight size={14} />
                  </Button>
                ) : (
                  <div>
                    {official && (
                      <Button
                        variant="outline"
                        disabled={
                          Boolean(busy) ||
                          !canManage ||
                          !currentTemplate ||
                          currentTemplate.status !== 'APPROVED' ||
                          dirty
                        }
                        onClick={() => void prepareTest()}
                      >
                        <Send size={14} /> Testar envio
                      </Button>
                    )}
                    {official ? (
                      <Button
                        disabled={
                          Boolean(busy) ||
                          !canManage ||
                          errors.length > 0 ||
                          (Boolean(editing?.provider_name) &&
                            editing?.publication_matches !== false &&
                            !dirty)
                        }
                        onClick={() => void publish()}
                      >
                        {busy === 'publish' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ShieldCheck size={14} />
                        )}
                        {busy === 'publish'
                          ? 'Preparando e enviando…'
                          : editing?.provider_name &&
                              editing.publication_matches !== false &&
                              !dirty
                            ? 'Enviado à Meta'
                            : 'Enviar para aprovação'}
                      </Button>
                    ) : (
                      <Button
                        disabled={
                          Boolean(busy) || !canManage || errors.length > 0
                        }
                        onClick={() => void prepareTest()}
                      >
                        {busy === 'save' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Send size={14} />
                        )}
                        Salvar e testar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div ref={preview} className={styles.previewColumn}>
              <StudioPreview
                draft={draft}
                businessName={instance?.display_name || 'Sua empresa'}
                activeCardId={activeCard?.id}
                onSelectCard={setActiveCardId}
              />
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent className={cn(shared.surface, styles.dialog)}>
          <AlertDialogHeader>
            <AlertDialogTitle>Vamos guardar esta ideia?</AlertDialogTitle>
            <AlertDialogDescription>
              Há alterações que ainda não foram salvas na biblioteca.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className={styles.fieldError}>
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>
              Continuar editando
            </AlertDialogCancel>
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => {
                setDraft(null);
                setLeaveOpen(false);
              }}
            >
              Descartar alterações
            </Button>
            <Button disabled={Boolean(busy)} onClick={() => void save(true)}>
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Salvar e sair
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent className={cn(shared.surface, styles.dialog)}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir esta criação da biblioteca?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” será removida da biblioteca. Um template já
              enviado à Meta permanece na sua conta WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter criação</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                const result = await deleteWhatsappStudioDraft(
                  workspaceId,
                  deleting.id,
                  deleting.revision,
                );
                if (result.success)
                  setEntries((current) =>
                    current.filter((entry) => entry.id !== deleting.id),
                  );
                else
                  toast({
                    title: 'Não foi possível excluir',
                    description: result.error,
                    variant: 'destructive',
                  });
              }}
            >
              Excluir da biblioteca
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={Boolean(testEntry)}
        onOpenChange={(open) => {
          if (!open && !busy) setTestEntry(null);
        }}
      >
        <DialogContent
          className={cn(shared.surface, styles.dialog)}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <span className={styles.dialogIcon}>
              <Send size={22} />
            </span>
            <DialogTitle>Veja sua criação do outro lado</DialogTitle>
            <DialogDescription>
              Uma mensagem real será enviada pela conexão{' '}
              <strong>{instance?.display_name}</strong>. Escolha um número seu
              ou de alguém que aceitou receber o teste.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.testSummary}>
            <span>
              {testEntry?.draft.kind === 'carousel' ? (
                <GalleryHorizontalEnd size={19} />
              ) : (
                <MessageCircle size={19} />
              )}
            </span>
            <div>
              <strong>{testEntry?.title}</strong>
              <p>
                {testEntry?.draft.kind === 'carousel'
                  ? testEntry.draft.cards.length + ' cartões · '
                  : ''}
                As personalizações usam os exemplos da prévia.
              </p>
            </div>
          </div>
          <div className={styles.field}>
            <Label htmlFor="test-recipient">Número que receberá o teste</Label>
            <Input
              autoFocus
              id="test-recipient"
              type="tel"
              inputMode="tel"
              value={recipient}
              disabled={Boolean(busy) || testAttempted}
              placeholder="+55 11 99999-9999"
              onChange={(event) => setRecipient(event.target.value)}
            />
            <p className={styles.hint}>Inclua o código do país e o DDD.</p>
          </div>
          {testError && (
            <p role="alert" className={styles.editorError}>
              <AlertCircle size={16} />
              {testError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => setTestEntry(null)}
            >
              Fechar
            </Button>
            <Button
              disabled={
                Boolean(busy) ||
                testAttempted ||
                !/^[1-9]\d{7,14}$/.test(recipient.replace(/[\s()+-]/g, ''))
              }
              onClick={() => void sendTest()}
            >
              {busy === 'send' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Enviar teste para este número
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(inspecting)}
        onOpenChange={(open) => {
          if (!open) setInspecting(null);
        }}
      >
        <DialogContent className={cn(shared.surface, styles.dialog)}>
          <DialogHeader>
            <span className={styles.dialogIcon}>
              <LayoutTemplate size={23} />
            </span>
            <DialogTitle>{inspecting?.name.replace(/_/g, ' ')}</DialogTitle>
            <DialogDescription>
              {inspecting &&
                (categoryLabels[inspecting.category] ||
                  inspecting.category)}{' '}
              · {inspecting?.language.replace('_', '-')}
            </DialogDescription>
          </DialogHeader>
          {inspecting && (
            <>
              <span
                className={styles.statusBadge}
                data-status={inspecting.status}
              >
                {statusLabels[inspecting.status] || 'Status indisponível'}
              </span>
              <div className={styles.templateDetails}>
                {inspecting.components
                  .filter(
                    (component) =>
                      component.type === 'HEADER' ||
                      component.type === 'BODY' ||
                      component.type === 'FOOTER',
                  )
                  .map((component, index) => (
                    <p key={index}>
                      {String(
                        component.text ||
                          (component.type === 'HEADER'
                            ? 'Cabeçalho com mídia'
                            : 'Texto definido pelo WhatsApp'),
                      )}
                    </p>
                  ))}
                {inspecting.components.some(
                  (component) => component.type === 'CAROUSEL',
                ) && (
                  <span>
                    <GalleryHorizontalEnd size={16} /> Este template contém um
                    carrossel.
                  </span>
                )}
              </div>
              {inspecting.rejection && (
                <p className={styles.editorError}>
                  <AlertCircle size={16} />
                  {inspecting.rejection}
                </p>
              )}
              <p className={styles.hint}>
                Ao usar como base, copiamos textos e botões. Adicione suas fotos
                para preparar uma nova versão.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInspecting(null)}>
                  Fechar
                </Button>
                <Button variant="outline" disabled={!canManage} onClick={() => { setEditingMeta(inspecting); setInspecting(null); }}><PencilLine size={14} /> Editar original</Button>
                <Button
                  disabled={!canManage}
                  onClick={() => {
                    const value = fromMeta(inspecting);
                    setInspecting(null);
                    openDraft(value);
                  }}
                >
                  <Copy size={14} /> Usar como base
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {editingMeta && <MetaTemplateEditor key={`${instanceId}:${editingMeta.id}`} template={editingMeta} workspaceId={workspaceId} instanceId={instanceId} onClose={() => setEditingMeta(null)} onUpdated={() => { setRefresh(value => value + 1); void loadLibrary(); toast({ title: 'Alterações enviadas à Meta', description: 'Acompanhe o status atualizado na biblioteca.' }); }} />}
    </section>
  );
}
