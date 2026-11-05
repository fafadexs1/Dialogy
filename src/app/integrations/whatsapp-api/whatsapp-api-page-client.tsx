'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  Clock3,
  GalleryHorizontalEnd,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { FaMeta, FaWhatsapp } from 'react-icons/fa6';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { EvolutionInstance } from '@/lib/types';
import {
  checkInstanceStatus,
  connectInstance,
  deleteEvolutionApiInstance,
  disconnectInstance,
  getEvolutionApiInstances,
  restartInstance,
} from '@/actions/evolution-api';
import {
  AddInstanceForm,
  EditInstanceDialog,
} from '../evolution-api/evolution-api-page-client';
import { EvolutionWebhookPanel } from '../evolution-api/evolution-webhook-panel';
import { WhatsappStudio } from '@/components/integrations/whatsapp-studio';
import shared from '@/app/team/team-page.module.css';
import styles from './whatsapp-api-page.module.css';

type Instance = Omit<EvolutionInstance, 'status' | 'qrCode'>;
type Status = EvolutionInstance['status'];
function ConnectionCard({
  initial,
  workspaceId,
  canManage,
  onRefresh,
  onStatus,
  initialQr,
}: {
  initial: Instance;
  workspaceId: string;
  canManage: boolean;
  onRefresh: () => void;
  onStatus: (id: string, status: Status | null) => void;
  initialQr?: string;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState(initialQr || '');
  const [qrOpen, setQrOpen] = useState(Boolean(initialQr));
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [confirm, setConfirm] = useState<'disconnect' | 'delete' | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const official = initial.type === 'wa_cloud';
  const applyStatus = useCallback(
    (result: { status: Status; qrCode?: string }) => {
      setStatus(result.status);
      if (result.qrCode) setQr(result.qrCode);
      if (result.status === 'connected') {
        setQrOpen(false);
        setQr('');
      }
      onStatus(initial.id, result.status);
      setCheckedAt(new Date());
      setStatusError('');
    },
    [initial.id, onStatus],
  );
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    const version = ++requestVersion.current;
    try {
      const result = await checkInstanceStatus(initial.instance_name);
      if (!mounted.current || version !== requestVersion.current) return;
      if (result.error) {
        setStatusError(result.error);
        onStatus(initial.id, null);
      } else applyStatus(result);
    } catch {
      if (mounted.current && version === requestVersion.current) {
        setStatusError('Não foi possível atualizar o status agora.');
        onStatus(initial.id, null);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [initial.id, initial.instance_name, applyStatus, onStatus]);
  useEffect(() => {
    mounted.current = true;
    void check();
    const timer = setInterval(check, status === 'pending' ? 3000 : 15_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [check, status]);
  useEffect(() => {
    if (initialQr) {
      setQr(initialQr);
      setQrOpen(true);
    }
  }, [initialQr]);
  async function connect() {
    setBusy(true);
    ++requestVersion.current;
    try {
      const result = await connectInstance(initial.instance_name);
      if (result.error) throw new Error(result.error);
      applyStatus(result);
      if (result.qrCode) setQrOpen(true);
    } catch (error) {
      toast({
        title: 'Não foi possível conectar',
        description:
          error instanceof Error
            ? error.message
            : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }
  async function confirmAction() {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        const result = await deleteEvolutionApiInstance(initial.id);
        if (result.error) throw new Error(result.error);
        toast({ title: 'Conexão removida' });
        onRefresh();
      } else {
        const result = await disconnectInstance(initial.instance_name);
        if (result.error) throw new Error(result.error);
        ++requestVersion.current;
        applyStatus(result);
        toast({ title: 'Conexão desconectada' });
      }
    } catch (error) {
      toast({
        title: 'Não foi possível concluir',
        description:
          error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  const label = statusError
    ? 'Status indisponível'
    : status === 'connected'
      ? 'Conectada'
      : status === 'pending'
        ? 'Aguardando conexão'
        : status === 'disconnected'
          ? 'Desconectada'
          : 'Verificando…';
  return (
    <article className={styles.connectionCard}>
      <div className={styles.cardHeader}>
        <span className={styles.whatsappIcon}>
          <FaWhatsapp size={25} />
        </span>
        <span
          className={styles.connectionStatus}
          data-status={statusError ? 'unknown' : status || 'unknown'}
        >
          <span />
          {label}
        </span>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Ações da conexão ' + initial.display_name}
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={shared.surface}>
              {!official && (
                <EditInstanceDialog
                  instance={{ ...initial, status: status || 'disconnected' }}
                  onSave={onRefresh}
                />
              )}
              <DropdownMenuItem
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await restartInstance(initial.instance_name);
                    if (result.error) throw new Error(result.error);
                    toast({
                      title: 'Reinicialização solicitada',
                      description: 'O status será atualizado automaticamente.',
                    });
                    await check();
                  } catch {
                    toast({
                      title: 'Não foi possível reiniciar',
                      variant: 'destructive',
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={14} className="mr-2" />
                Reiniciar conexão
              </DropdownMenuItem>
              {status === 'connected' && (
                <DropdownMenuItem onClick={() => setConfirm('disconnect')}>
                  <PowerOff size={14} className="mr-2" />
                  Desconectar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirm('delete')}
                className="text-destructive"
              >
                <Trash2 size={14} className="mr-2" />
                Remover conexão
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <h3>{initial.display_name}</h3>
      <p className={styles.connectionNumber}>
        {initial.display_phone_number ||
          (official
            ? initial.verified_name ||
              initial.business_name ||
              'Conta WhatsApp Business'
            : 'Seu número aparece no WhatsApp conectado')}
      </p>
      <span className={styles.typeBadge}>
        {official ? <FaMeta size={15} /> : <QrCode size={13} />}
        {official ? 'API oficial · Meta' : 'QR Code · conexão não oficial'}
      </span>
      <div className={styles.connectionFeatures}>
        {official ? (
          <>
            <span>
              <ShieldCheck size={13} /> Templates com aprovação
            </span>
            <span>
              <GalleryHorizontalEnd size={13} /> Carrosséis oficiais
            </span>
          </>
        ) : (
          <>
            <span>
              <MessageCircle size={13} /> Mensagens diretas
            </span>
            <span>
              <GalleryHorizontalEnd size={13} /> Carrosséis livres
            </span>
          </>
        )}
      </div>
      <div className={styles.cardFooter}>
        <span>
          <Clock3 size={12} />
          {checkedAt
            ? 'Consultado às ' +
              checkedAt.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Consultando conexão'}
        </span>
        {status === 'pending' && qr ? (
          <Button size="sm" onClick={() => setQrOpen(true)}>
            <QrCode size={14} /> Ver QR Code
          </Button>
        ) : status !== 'connected' && !statusError && canManage ? (
          <Button size="sm" disabled={busy} onClick={() => void connect()}>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Power size={14} />
            )}
            Conectar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={checking || busy}
            onClick={() => void check()}
          >
            <RefreshCw size={13} className={cn(checking && 'animate-spin')} />{' '}
            Atualizar
          </Button>
        )}
      </div>
      {statusError && (
        <p className={styles.connectionError} role="status">
          <AlertCircle size={13} />
          {statusError}{' '}
          <button type="button" onClick={() => void check()}>
            Tentar novamente
          </button>
        </p>
      )}
      {canManage && (
        <details className={styles.technicalDetails}>
          <summary>
            <SlidersHorizontal size={13} /> Configurações técnicas{' '}
            <ChevronRight size={13} />
          </summary>
          <div>
            <p className={styles.instanceIdentifier}>
              Identificador: <code>{initial.instance_name}</code>
            </p>
            <EvolutionWebhookPanel
              instance={initial}
              workspaceId={workspaceId}
            />
          </div>
        </details>
      )}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent
          className={cn(shared.surface, styles.dialog, styles.qrDialog)}
        >
          <DialogHeader>
            <span className={styles.dialogIcon}>
              <QrCode size={24} />
            </span>
            <DialogTitle>Só falta aproximar o celular</DialogTitle>
            <DialogDescription>
              Conecte o WhatsApp de <strong>{initial.display_name}</strong> para
              começar.
            </DialogDescription>
          </DialogHeader>
          {qr ? (
            <Image
              src={qr}
              alt="QR Code para conectar seu WhatsApp"
              width={250}
              height={250}
              unoptimized
              className={styles.qrImage}
            />
          ) : (
            <Loader2 size={30} className="animate-spin" />
          )}
          <ol>
            <li>
              <span>1</span>Abra o WhatsApp no celular.
            </li>
            <li>
              <span>2</span>Toque em Aparelhos conectados.
            </li>
            <li>
              <span>3</span>Escolha Conectar aparelho e leia o código.
            </li>
          </ol>
          <p className={styles.qrNote}>
            A conexão será confirmada automaticamente. Se o código expirar,
            feche esta janela e conecte novamente.
          </p>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent className={cn(shared.surface, styles.dialog)}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'delete'
                ? 'Remover esta conexão?'
                : 'Desconectar este número?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? 'A conexão “' +
                  initial.display_name +
                  '” será removida da Dialogy. Suas criações continuam na biblioteca e podem ser copiadas para outra conexão.'
                : 'O número “' +
                  initial.display_name +
                  '” deixará de enviar e receber mensagens nesta conexão até ser conectado novamente.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Manter conexão
            </AlertDialogCancel>
            <Button
              disabled={busy}
              variant="destructive"
              onClick={() => void confirmAction()}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {confirm === 'delete' ? 'Remover conexão' : 'Desconectar'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function WhatsappWorkspace({ workspaceId }: { workspaceId: string }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [limit, setLimit] = useState<{
    reached: boolean;
    current: number;
    max: number;
    plan: string;
  } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<Record<string, Status | null>>({});
  const [newQr, setNewQr] = useState<{ id: string; code: string } | null>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    try {
      const result = await getEvolutionApiInstances(workspaceId);
      if (version !== loadVersion.current) return;
      if (result.error)
        throw new Error(
          'Não foi possível carregar suas conexões. Tente novamente.',
        );
      setInstances(
        (result.instances || []).filter((instance) =>
          ['baileys', 'wa_cloud'].includes(instance.type),
        ),
      );
      setCanManage(result.canManageWebhooks === true);
      if (result.limitStatus) setLimit(result.limitStatus);
    } catch (error) {
      if (version === loadVersion.current)
        setError(
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar as conexões.',
        );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    const version = loadVersion;
    void load();
    return () => {
      ++version.current;
    };
  }, [load]);
  const onStatus = useCallback(
    (id: string, status: Status | null) =>
      setStatuses((current) =>
        current[id] === status ? current : { ...current, [id]: status },
      ),
    [],
  );
  const filtered = instances.filter((instance) =>
    [
      instance.display_name,
      instance.display_phone_number,
      instance.verified_name,
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .includes(
        search
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim(),
      ),
  );
  const connected = instances.filter(
    (instance) => statuses[instance.id] === 'connected',
  ).length;
  const unknown = instances.some((instance) => !statuses[instance.id]);
  return (
    <div className={cn(shared.surface, shared.page, styles.page)}>
      <header className={shared.pageHeader}>
        <div className={shared.headerTop}>
          <div className={shared.breadcrumb}>
            <Link href="/integrations">Integrações</Link>
            <ChevronRight size={12} />
            <span>WhatsApp API</span>
          </div>
          <span className={shared.headerLabel}>
            <FaWhatsapp size={15} /> Seu próximo ponto de encontro
          </span>
        </div>
        <div className={shared.welcomeRow}>
          <div>
            <span className={shared.eyebrow}>WHATSAPP API</span>
            <h1>
              Mais perto, em cada conversa
              <span className={shared.titleDot}>.</span>
            </h1>
            <p>
              Seus números, mensagens e carrosséis em uma experiência mais
              simples de cuidar.
            </p>
          </div>
          <Button
            className={shared.createButton}
            disabled={!canManage || loading || Boolean(limit?.reached)}
            onClick={() => setModalOpen(true)}
          >
            {limit?.reached ? <LockKeyhole size={16} /> : <Plus size={17} />}
            {limit?.reached ? 'Limite de conexões atingido' : 'Conectar número'}
            {!limit?.reached && <ArrowUpRight size={15} />}
          </Button>
        </div>
        <div className={shared.workspaceSummary}>
          <span>
            <MessageCircle size={14} />
            <strong>
              {loading && !instances.length ? '…' : instances.length}
            </strong>{' '}
            {instances.length === 1 ? 'conexão' : 'conexões'}
          </span>
          <span>
            <span className={styles.summaryDot} />
            <strong>{unknown ? '—' : connected}</strong>
            {connected === 1 && !unknown ? 'conectada' : 'conectadas'}
          </span>
          <span>
            <ShieldCheck size={14} />
            <strong>
              {
                instances.filter((instance) => instance.type === 'wa_cloud')
                  .length
              }
            </strong>{' '}
            {instances.filter((instance) => instance.type === 'wa_cloud')
              .length === 1
              ? 'conta oficial'
              : 'contas oficiais'}
          </span>
          {limit && (
            <span className={shared.summaryHint}>
              {limit.max < 0
                ? 'Seu plano permite conexões ilimitadas'
                : limit.current +
                  ' de ' +
                  limit.max +
                  ' conexões do plano em uso'}
            </span>
          )}
        </div>
      </header>
      <Tabs defaultValue="connections" className={styles.tabs}>
        <TabsList className={styles.tabBar}>
          <TabsTrigger value="connections">
            <MessageCircle size={15} /> Conexões <span>{instances.length}</span>
          </TabsTrigger>
          <TabsTrigger value="studio">
            <Sparkles size={15} /> Estúdio de mensagens{' '}
            <ArrowUpRight size={12} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="connections" forceMount className={styles.tabPanel}>
          <div className={styles.connectionsHeading}>
            <div>
              <span className={shared.eyebrow}>SEU WHATSAPP, BEM CUIDADO</span>
              <h2>Cada número, uma porta aberta</h2>
              <p>
                Acompanhe suas conexões e deixe o caminho livre para boas
                conversas.
              </p>
            </div>
            <div className={styles.connectionTools}>
              <Input
                aria-label="Buscar conexão por nome ou número"
                value={search}
                placeholder="Busque por nome ou número…"
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Atualizar conexões"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw
                  size={15}
                  className={cn(loading && 'animate-spin')}
                />
              </Button>
            </div>
          </div>
          {error && (
            <div className={styles.error} role="alert">
              <AlertCircle size={17} />
              <p>{error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Tentar novamente
              </Button>
            </div>
          )}
          {loading && !instances.length ? (
            <div className={styles.connectionGrid}>
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          ) : instances.length ? (
            <div className={styles.connectionGrid}>
              {filtered.map((instance) => (
                <ConnectionCard
                  key={instance.id}
                  initial={instance}
                  workspaceId={workspaceId}
                  canManage={canManage}
                  onRefresh={() => void load()}
                  onStatus={onStatus}
                  initialQr={newQr?.id === instance.id ? newQr.code : undefined}
                />
              ))}
              {!search && canManage && !limit?.reached && (
                <button
                  type="button"
                  className={styles.addConnection}
                  onClick={() => setModalOpen(true)}
                >
                  <span>
                    <Plus size={23} />
                  </span>
                  <strong>Mais um número, novas possibilidades</strong>
                  <p>Conecte por QR Code ou use uma conta oficial.</p>
                  <small>
                    Adicionar conexão <ArrowRight size={14} />
                  </small>
                </button>
              )}
            </div>
          ) : (
            !error && (
              <div className={styles.empty}>
                <span className={styles.dialogIcon}>
                  <FaWhatsapp size={31} />
                </span>
                <h3>Sua próxima conversa começa aqui</h3>
                <p>
                  Conecte um número e reúna seu atendimento, suas mensagens e
                  seus carrosséis na Dialogy.
                </p>
                {canManage && (
                  <Button
                    disabled={Boolean(limit?.reached)}
                    onClick={() => setModalOpen(true)}
                  >
                    Conectar meu primeiro número <ArrowRight size={15} />
                  </Button>
                )}
              </div>
            )
          )}
          {search && !filtered.length && (
            <p className={styles.noResults}>
              Não encontramos uma conexão para “{search}”.
            </p>
          )}
          <div className={styles.connectionGuide}>
            <span className={styles.guideIcon}>
              <CircleHelp size={20} />
            </span>
            <div>
              <h3>Duas formas de se conectar. Um só lugar para cuidar.</h3>
              <p>
                <strong>QR Code</strong> conecta pelo celular e permite
                mensagens e carrosséis diretos. <strong>API oficial</strong> usa
                sua conta Meta e templates aprovados para iniciar conversas.
              </p>
            </div>
            <span>
              <ShieldCheck size={14} /> Cada conexão com seu espaço
            </span>
          </div>
        </TabsContent>
        <TabsContent value="studio" forceMount className={styles.tabPanel}>
          <WhatsappStudio
            workspaceId={workspaceId}
            instances={instances}
            canManage={canManage}
            onConnect={() => setModalOpen(true)}
          />
        </TabsContent>
      </Tabs>
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className={cn(shared.surface, styles.dialog, styles.connectDialog)}
        >
          <DialogTitle className="sr-only">
            Conectar um número WhatsApp
          </DialogTitle>
          <DialogDescription className="sr-only">
            Escolha conexão por QR Code ou API oficial da Meta.
          </DialogDescription>
          <AddInstanceForm
            workspaceId={workspaceId}
            channelMode="whatsapp"
            onClose={() => setModalOpen(false)}
            onSuccess={(qrCode, instanceId) => {
              setModalOpen(false);
              if (qrCode && instanceId)
                setNewQr({ id: instanceId, code: qrCode });
              void load();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WhatsappApiPage() {
  const user = useCurrentUser();
  if (!user)
    return (
      <div className={styles.loading} role="status">
        <Loader2 size={27} className="animate-spin" />
        <span>Preparando seu WhatsApp…</span>
      </div>
    );
  if (!user.activeWorkspaceId)
    return (
      <div className={cn(shared.surface, styles.loading)}>
        Escolha um workspace para cuidar das suas conexões.
      </div>
    );
  return (
    <WhatsappWorkspace
      key={user.activeWorkspaceId}
      workspaceId={user.activeWorkspaceId}
    />
  );
}
