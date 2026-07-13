'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  Award,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  Clock3,
  Filter,
  Gauge,
  Inbox,
  Info,
  Loader2,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  PieChart as PieChartIcon,
  Send,
  Target,
  TrendingUp,
  UserRoundCheck,
  Users,
  Users2,
  Zap,
} from 'lucide-react';
import { FaFacebookMessenger, FaInstagram, FaTelegram, FaWhatsapp } from 'react-icons/fa6';
import { format, endOfDay, endOfMonth, startOfDay, startOfMonth, subDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import {
  getAgentPerformance,
  getAnalyticsData,
  getConversionMetrics,
  getConversionSettings,
  getWorkspaceMembers,
  updateConversionSettings,
} from '@/actions/analytics';
import { getTeams } from '@/actions/teams';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/use-online-status';
import type {
  AgentPerformance,
  AnalyticsData,
  ConversionCounterMode,
  ConversionMetrics,
  Team,
  User,
} from '@/lib/types';

type TimeRange = 'last_30_days' | 'last_7_days' | 'today' | 'this_month';
type AnalyticsTab = 'overview' | 'channels' | 'team' | 'conversion';
type StatTone = 'emerald' | 'blue' | 'violet' | 'amber' | 'rose' | 'cyan' | 'slate';
type IconComponent = React.ComponentType<{ className?: string }>;

const timeRangeLabels: Record<TimeRange, string> = {
  today: 'Hoje',
  last_7_days: 'Ultimos 7 dias',
  this_month: 'Este mes',
  last_30_days: 'Ultimos 30 dias',
};

const numberFormatter = new Intl.NumberFormat('pt-BR');
const compactNumberFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
});

const chartGridColor = 'hsl(var(--border))';
const chartAxisColor = 'hsl(var(--muted-foreground))';
const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.18)',
};

const toneClasses: Record<StatTone, { icon: string; surface: string; accent: string }> = {
  emerald: {
    icon: 'text-emerald-600 dark:text-emerald-400',
    surface: 'border-emerald-100 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10',
    accent: 'text-emerald-600 dark:text-emerald-300',
  },
  blue: {
    icon: 'text-blue-600 dark:text-blue-400',
    surface: 'border-blue-100 bg-blue-50 dark:border-blue-500/20 dark:bg-blue-500/10',
    accent: 'text-blue-600 dark:text-blue-300',
  },
  violet: {
    icon: 'text-violet-600 dark:text-violet-400',
    surface: 'border-violet-100 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10',
    accent: 'text-violet-600 dark:text-violet-300',
  },
  amber: {
    icon: 'text-amber-600 dark:text-amber-300',
    surface: 'border-amber-100 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10',
    accent: 'text-amber-600 dark:text-amber-300',
  },
  rose: {
    icon: 'text-rose-600 dark:text-rose-400',
    surface: 'border-rose-100 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10',
    accent: 'text-rose-600 dark:text-rose-300',
  },
  cyan: {
    icon: 'text-cyan-600 dark:text-cyan-300',
    surface: 'border-cyan-100 bg-cyan-50 dark:border-cyan-500/20 dark:bg-cyan-500/10',
    accent: 'text-cyan-600 dark:text-cyan-300',
  },
  slate: {
    icon: 'text-muted-foreground',
    surface: 'border-border bg-muted/30',
    accent: 'text-muted-foreground',
  },
};

function getDateRange(range: TimeRange, timeZone = 'America/Sao_Paulo'): { from: string; to: string } {
  const now = toZonedTime(new Date(), timeZone);
  let from: Date;
  let to: Date;

  switch (range) {
    case 'today':
      from = startOfDay(now);
      to = endOfDay(now);
      break;
    case 'last_7_days':
      from = startOfDay(subDays(now, 6));
      to = endOfDay(now);
      break;
    case 'this_month':
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
    case 'last_30_days':
    default:
      from = startOfDay(subDays(now, 29));
      to = endOfDay(now);
      break;
  }

  return {
    from: fromZonedTime(from, timeZone).toISOString(),
    to: fromZonedTime(to, timeZone).toISOString(),
  };
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value: number) {
  return `${decimalFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function formatNumber(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatCompact(value: number) {
  return compactNumberFormatter.format(Number.isFinite(value) ? value : 0);
}

function getChannelPercent(value: number, total: number) {
  if (!total) return 0;
  return (value / total) * 100;
}

function ChannelIcon({
  name,
  color,
  className = 'h-4 w-4',
}: {
  name: string;
  color?: string;
  className?: string;
}) {
  const style = color ? { color } : undefined;

  switch (name) {
    case 'WhatsApp':
      return <FaWhatsapp className={className} style={style} />;
    case 'Instagram':
      return <FaInstagram className={className} style={style} />;
    case 'Messenger':
      return <FaFacebookMessenger className={className} style={style} />;
    case 'Telegram':
      return <FaTelegram className={className} style={style} />;
    default:
      return <MessageCircle className={className} style={style} />;
  }
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  tone = 'slate',
  loading,
}: {
  title: string;
  value: React.ReactNode;
  description: string;
  icon: IconComponent;
  tone?: StatTone;
  loading: boolean;
}) {
  const toneClass = toneClasses[tone];

  return (
    <Card className="rounded-lg border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </div>
        <div className={`rounded-lg border p-2 ${toneClass.surface}`}>
          <Icon className={`h-4 w-4 ${toneClass.icon}`} />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-24 bg-muted" />
            <Skeleton className="h-4 w-36 bg-muted" />
          </div>
        ) : (
          <>
            <div className="break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">{value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function MetricLine({
  label,
  value,
  detail,
  info,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  info?: string;
  icon: IconComponent;
  tone?: StatTone;
}) {
  const toneClass = toneClasses[tone];

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`rounded-lg border p-2 ${toneClass.surface}`}>
          <Icon className={`h-4 w-4 ${toneClass.icon}`} />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{label}</p>
            {info && (
              <TooltipProvider delayDuration={150}>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`O que significa ${label}`}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-[280px] text-xs leading-5">
                    {info}
                  </TooltipContent>
                </UiTooltip>
              </TooltipProvider>
            )}
          </div>
          {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
        </div>
      </div>
      <div className={`shrink-0 text-right text-sm font-semibold ${toneClass.accent}`}>{value}</div>
    </div>
  );
}

function AgentPerformanceTable({
  performance,
  loading,
}: {
  performance: AgentPerformance[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-16 text-center">Pos.</TableHead>
              <TableHead>Atendente</TableHead>
              <TableHead className="text-center">Atendimentos</TableHead>
              <TableHead className="text-center">Resolvidos</TableHead>
              <TableHead className="text-center">T.M.R.</TableHead>
              <TableHead className="text-center">Resolucao</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Skeleton className="mx-auto h-8 w-8 rounded-full bg-muted" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-44 bg-muted" />
                </TableCell>
                <TableCell>
                  <Skeleton className="mx-auto h-6 w-16 bg-muted" />
                </TableCell>
                <TableCell>
                  <Skeleton className="mx-auto h-6 w-16 bg-muted" />
                </TableCell>
                <TableCell>
                  <Skeleton className="mx-auto h-6 w-20 bg-muted" />
                </TableCell>
                <TableCell>
                  <Skeleton className="mx-auto h-6 w-16 bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (!performance.length) {
    return <EmptyPanel label="Nenhum atendimento encontrado para os filtros atuais." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow className="border-border">
            <TableHead className="w-16 text-center text-muted-foreground">Pos.</TableHead>
            <TableHead className="min-w-[220px] text-muted-foreground">Atendente</TableHead>
            <TableHead className="text-center text-muted-foreground">Atendimentos</TableHead>
            <TableHead className="text-center text-muted-foreground">Resolvidos</TableHead>
            <TableHead className="text-center text-muted-foreground">T.M.R.</TableHead>
            <TableHead className="text-center text-muted-foreground">Resolucao</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {performance.map((agent, index) => {
            const agentName = agent.agent_name || 'Atendente';
            const resolution = agent.total_chats > 0 ? (agent.resolved_chats / agent.total_chats) * 100 : 0;
            const rankStyle =
              index === 0
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300'
                : index === 1
                  ? 'border-border bg-muted/30 text-muted-foreground'
                  : index === 2
                    ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300'
                    : 'border-border bg-background text-muted-foreground';

            return (
              <TableRow key={agent.agent_id} className="border-border hover:bg-muted/30">
                <TableCell>
                  <div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${rankStyle}`}>
                    {index < 3 ? <Award className="h-4 w-4" /> : index + 1}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarImage src={agent.avatar_url || undefined} alt={agentName} />
                      <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                        {agentName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-foreground">{agentName}</span>
                  </div>
                </TableCell>
                <TableCell className="text-center text-base font-semibold text-foreground">
                  {formatNumber(agent.total_chats)}
                </TableCell>
                <TableCell className="text-center text-muted-foreground">{formatNumber(agent.resolved_chats)}</TableCell>
                <TableCell className="text-center font-mono text-sm text-muted-foreground">
                  {agent.avg_first_response_time || 'N/A'}
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {formatPercent(resolution)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AnalyticsPage() {
  const user = useCurrentUser();
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformance[]>([]);
  const [conversionMetrics, setConversionMetrics] = useState<ConversionMetrics | null>(null);
  const [conversionCounterMode, setConversionCounterMode] = useState<ConversionCounterMode>('won_deals');
  const [isSavingConversionMode, setIsSavingConversionMode] = useState(false);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [isAgentPerformanceLoading, setIsAgentPerformanceLoading] = useState(false);
  const [isConversionLoading, setIsConversionLoading] = useState(false);
  const [allMembers, setAllMembers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('last_30_days');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');

  useEffect(() => {
    if (!user?.activeWorkspaceId) return;

    let cancelled = false;

    Promise.all([
      getWorkspaceMembers(user.activeWorkspaceId),
      getTeams(user.activeWorkspaceId),
      getConversionSettings(user.activeWorkspaceId),
    ])
      .then(([membersResult, teamsResult, conversionSettingsResult]) => {
        if (cancelled) return;
        if (membersResult.members) setAllMembers(membersResult.members as User[]);
        if (teamsResult.teams) setTeams(teamsResult.teams);
        if (conversionSettingsResult.settings) {
          setConversionCounterMode(conversionSettingsResult.settings.counterMode);
        }
      })
      .catch((error) => {
        console.error('[ANALYTICS_PAGE] Failed to load filter options:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (!user?.activeWorkspaceId) return;

    let cancelled = false;
    const activeWorkspace = user.workspaces?.find((workspace) => workspace.id === user.activeWorkspaceId);
    const workspaceTimeZone = user.activeWorkspaceTimezone || activeWorkspace?.timezone || 'America/Sao_Paulo';
    const filters = {
      teamId: selectedTeamId === 'all' ? undefined : selectedTeamId,
      agentId: selectedAgentId === 'all' ? undefined : selectedAgentId,
    };
    const dateRange = getDateRange(timeRange, workspaceTimeZone);

    setIsAnalyticsLoading(true);
    getAnalyticsData(user.activeWorkspaceId, filters, dateRange)
      .then((analytics) => {
        if (cancelled) return;
        setAnalyticsData(analytics);
      })
      .catch((error) => {
        console.error('[ANALYTICS_PAGE] Failed to load analytics overview:', error);
      })
      .finally(() => {
        if (!cancelled) setIsAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedAgentId,
    selectedTeamId,
    timeRange,
    user?.activeWorkspaceId,
    user?.activeWorkspaceTimezone,
    user?.workspaces,
  ]);

  useEffect(() => {
    if (!user?.activeWorkspaceId || activeTab !== 'team') return;

    let cancelled = false;
    const activeWorkspace = user.workspaces?.find((workspace) => workspace.id === user.activeWorkspaceId);
    const workspaceTimeZone = user.activeWorkspaceTimezone || activeWorkspace?.timezone || 'America/Sao_Paulo';
    const filters = {
      teamId: selectedTeamId === 'all' ? undefined : selectedTeamId,
      agentId: selectedAgentId === 'all' ? undefined : selectedAgentId,
    };

    setIsAgentPerformanceLoading(true);
    getAgentPerformance(user.activeWorkspaceId, filters, getDateRange(timeRange, workspaceTimeZone))
      .then((performance) => {
        if (!cancelled) setAgentPerformance(performance || []);
      })
      .catch((error) => console.error('[ANALYTICS_PAGE] Failed to load agent performance:', error))
      .finally(() => {
        if (!cancelled) setIsAgentPerformanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedAgentId, selectedTeamId, timeRange, user?.activeWorkspaceId, user?.activeWorkspaceTimezone, user?.workspaces]);

  useEffect(() => {
    if (!user?.activeWorkspaceId || activeTab !== 'conversion') return;

    let cancelled = false;
    const activeWorkspace = user.workspaces?.find((workspace) => workspace.id === user.activeWorkspaceId);
    const workspaceTimeZone = user.activeWorkspaceTimezone || activeWorkspace?.timezone || 'America/Sao_Paulo';
    const filters = {
      teamId: selectedTeamId === 'all' ? undefined : selectedTeamId,
      agentId: selectedAgentId === 'all' ? undefined : selectedAgentId,
    };

    setIsConversionLoading(true);
    getConversionMetrics(
      user.activeWorkspaceId,
      filters,
      getDateRange(timeRange, workspaceTimeZone),
      conversionCounterMode,
    )
      .then((metrics) => {
        if (!cancelled) setConversionMetrics(metrics);
      })
      .catch((error) => console.error('[ANALYTICS_PAGE] Failed to load conversions:', error))
      .finally(() => {
        if (!cancelled) setIsConversionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, conversionCounterMode, selectedAgentId, selectedTeamId, timeRange, user?.activeWorkspaceId, user?.activeWorkspaceTimezone, user?.workspaces]);

  const handleTeamChange = useCallback((teamId: string) => {
    // Batch dependent filters so changing a team never launches a throwaway
    // request with an agent from the previously selected team.
    setSelectedTeamId(teamId);
    setSelectedAgentId('all');
  }, []);

  const filteredMembers = useMemo(() => {
    const members =
      selectedTeamId === 'all'
        ? allMembers
        : allMembers.filter((member) => (member as User & { team_id?: string }).team_id === selectedTeamId);

    return Array.from(new Map(members.map((member) => [member.id, member])).values());
  }, [allMembers, selectedTeamId]);

  const selectedAgentName = useMemo(() => {
    if (selectedAgentId === 'all') return null;
    return allMembers.find((member) => member.id === selectedAgentId)?.name || 'Atendente';
  }, [allMembers, selectedAgentId]);

  const handleCounterModeChange = useCallback(
    async (nextValue: string) => {
      const normalized = (nextValue === 'unique_converted_contacts'
        ? 'unique_converted_contacts'
        : 'won_deals') as ConversionCounterMode;

      setConversionCounterMode(normalized);

      if (!user?.activeWorkspaceId) return;

      setIsSavingConversionMode(true);
      const result = await updateConversionSettings(user.activeWorkspaceId, normalized);
      if (!result.success) {
        console.error('[ANALYTICS_PAGE] Failed to save conversion counter mode:', result.error);
      }
      setIsSavingConversionMode(false);
    },
    [user?.activeWorkspaceId]
  );

  if (!user) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
      </div>
    );
  }

  const conversationsByHour = analyticsData?.conversationsByHour || [];
  const rawChannelsData = analyticsData?.conversationsByChannel || [];
  const channelsChartData = rawChannelsData.length
    ? rawChannelsData
    : [{ name: 'Sem dados', value: 1, color: 'hsl(var(--muted-foreground))' }];
  const channelTotal = rawChannelsData.reduce((acc, channel) => acc + channel.value, 0);
  const totalConversations = analyticsData?.totalConversations ?? 0;
  const resolvedConversations = analyticsData?.resolvedConversations ?? 0;
  const openConversations = analyticsData?.openConversations ?? 0;
  const automationConversations = analyticsData?.automationConversations ?? 0;
  const totalMessages = analyticsData?.totalMessages ?? 0;
  const customerMessages = analyticsData?.customerMessages ?? 0;
  const agentMessages = analyticsData?.agentMessages ?? 0;
  const avgMessagesPerConversation = analyticsData?.avgMessagesPerConversation ?? 0;
  const resolutionRate = analyticsData?.firstContactResolutionRate ?? 0;
  const automationRate = totalConversations > 0 ? (automationConversations / totalConversations) * 100 : 0;
  const customerMessageRate = totalMessages > 0 ? (customerMessages / totalMessages) * 100 : 0;
  const topChannel = rawChannelsData[0];
  const topHour = conversationsByHour.reduce(
    (best, current) => (current.count > best.count ? current : best),
    { hour: 'N/A', count: 0 }
  );
  const performanceToDisplay =
    selectedAgentId === 'all'
      ? agentPerformance
      : agentPerformance.filter((agent) => agent.agent_id === selectedAgentId);
  const topAgent = performanceToDisplay[0];
  const displayedResolved = performanceToDisplay.reduce((acc, agent) => acc + agent.resolved_chats, 0);
  const displayedChats = performanceToDisplay.reduce((acc, agent) => acc + agent.total_chats, 0);
  const displayedResolution = displayedChats > 0 ? (displayedResolved / displayedChats) * 100 : 0;
  const conversionCounterValue = conversionMetrics?.counterValue ?? 0;
  const conversionRate = totalConversations > 0 ? (conversionCounterValue / totalConversations) * 100 : 0;
  const isInitialAnalyticsLoading = isAnalyticsLoading && analyticsData === null;
  const isInitialAgentLoading = isAgentPerformanceLoading && agentPerformance.length === 0;
  const isInitialConversionLoading = isConversionLoading && conversionMetrics === null;
  const isRefreshing = isAnalyticsLoading || isAgentPerformanceLoading || isConversionLoading;

  return (
    <div className="min-h-full bg-background pb-10 text-foreground selection:bg-emerald-500/20">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 md:p-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
              <Zap className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">Analytics</h1>
                {isRefreshing && !isInitialAnalyticsLoading ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" aria-live="polite">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Atualizando
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {timeRangeLabels[timeRange]} com filtros de setor, atendente e canais.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-2 shadow-sm sm:grid-cols-2 xl:flex xl:items-center">
            <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
              <SelectTrigger className="h-10 w-full border-border bg-background text-foreground xl:w-[180px]">
                <Calendar className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <SelectValue placeholder="Periodo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="last_7_days">Ultimos 7 dias</SelectItem>
                <SelectItem value="this_month">Este mes</SelectItem>
                <SelectItem value="last_30_days">Ultimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedTeamId} onValueChange={handleTeamChange}>
              <SelectTrigger className="h-10 w-full border-border bg-background text-foreground xl:w-[190px]">
                <Users2 className="mr-2 h-4 w-4 text-blue-600 dark:text-blue-400" />
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
              disabled={filteredMembers.length === 0 && selectedTeamId !== 'all'}
            >
              <SelectTrigger className="h-10 w-full border-border bg-background text-foreground xl:w-[190px]">
                <Filter className="mr-2 h-4 w-4 text-violet-600 dark:text-violet-400" />
                <SelectValue placeholder="Atendente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda a equipe</SelectItem>
                {filteredMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AnalyticsTab)} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-muted-foreground lg:w-fit lg:grid-cols-4">
            <TabsTrigger value="overview" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground">
              <BarChart3 className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="channels" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground">
              <PieChartIcon className="h-4 w-4" />
              Canais
            </TabsTrigger>
            <TabsTrigger value="team" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground">
              <Users className="h-4 w-4" />
              Equipe
            </TabsTrigger>
            <TabsTrigger value="conversion" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground">
              <Target className="h-4 w-4" />
              Conversoes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Conversas"
                value={formatNumber(totalConversations)}
                description={`${formatNumber(openConversations)} abertas no periodo`}
                icon={MessagesSquare}
                tone="emerald"
                loading={isInitialAnalyticsLoading}
              />
              <StatCard
                title="Novos contatos"
                value={formatNumber(analyticsData?.newContacts ?? 0)}
                description="Contatos criados no workspace"
                icon={Users}
                tone="blue"
                loading={isInitialAnalyticsLoading}
              />
              <StatCard
                title="Tempo de resposta"
                value={analyticsData?.avgFirstResponseTime || '0m 0s'}
                description="Media entre cliente e proxima resposta"
                icon={Clock3}
                tone="violet"
                loading={isInitialAnalyticsLoading}
              />
              <StatCard
                title="Resolucao"
                value={formatPercent(resolutionRate)}
                description={`${formatNumber(resolvedConversations)} conversas encerradas`}
                icon={CheckCircle2}
                tone="amber"
                loading={isInitialAnalyticsLoading}
              />
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
              <Card className="rounded-lg border-border bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Clock3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Volume por hora
                  </CardTitle>
                  <CardDescription>Distribuicao de conversas por horario.</CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                  {isInitialAnalyticsLoading ? (
                    <Skeleton className="h-full w-full rounded-lg bg-muted" />
                  ) : conversationsByHour.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={conversationsByHour} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                        <XAxis
                          dataKey="hour"
                          axisLine={false}
                          tickLine={false}
                          fontSize={11}
                          stroke={chartAxisColor}
                          dy={10}
                        />
                        <YAxis axisLine={false} tickLine={false} fontSize={11} stroke={chartAxisColor} />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--muted) / 0.45)' }}
                          contentStyle={chartTooltipStyle}
                        />
                        <Bar dataKey="count" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyPanel label="Nenhuma conversa encontrada para montar o grafico." />
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-lg border-border bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Gauge className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    Operacao
                  </CardTitle>
                  <CardDescription>Indicadores resumidos do periodo.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isInitialAnalyticsLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-12 w-full rounded-lg bg-muted" />
                      ))}
                    </div>
                  ) : (
                    <div>
                      <MetricLine
                        label="Canal lider"
                        value={topChannel ? topChannel.name : 'N/A'}
                        detail={topChannel ? `${formatNumber(topChannel.value)} conversas` : 'Sem dados'}
                        info="Canal com mais conversas ativas dentro do periodo selecionado. A origem e identificada por Meta, mensagens, instancia e JID do contato."
                        icon={topChannel ? () => <ChannelIcon name={topChannel.name} color={topChannel.color} /> : MessageCircle}
                        tone="blue"
                      />
                      <MetricLine
                        label="Hora de pico"
                        value={topHour.hour}
                        detail={`${formatNumber(topHour.count)} conversas`}
                        info="Horario com maior volume de conversas ativas no periodo. Para conversas antigas, usa a primeira mensagem registrada dentro do periodo."
                        icon={Activity}
                        tone="emerald"
                      />
                      <MetricLine
                        label="Automacao"
                        value={formatPercent(automationRate)}
                        detail={`${formatNumber(automationConversations)} conversas com IA`}
                        info="Percentual de conversas ativas no periodo que estavam com agente de IA atribuido ou piloto automatico ativo."
                        icon={Bot}
                        tone="violet"
                      />
                      <MetricLine
                        label="Mensagens"
                        value={formatCompact(totalMessages)}
                        detail={`${formatPercent(customerMessageRate)} enviadas por clientes`}
                        info="Total de mensagens enviadas no periodo selecionado. O detalhe mostra a porcentagem dessas mensagens que vieram dos clientes."
                        icon={MessageSquare}
                        tone="amber"
                      />
                      <MetricLine
                        label="Media por conversa"
                        value={decimalFormatter.format(avgMessagesPerConversation)}
                        detail={`${formatNumber(customerMessages)} clientes / ${formatNumber(agentMessages)} atendentes`}
                        info="Media de mensagens por conversa ativa no periodo. O detalhe separa mensagens recebidas de clientes e enviadas por atendentes."
                        icon={Inbox}
                        tone="rose"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="channels" className="space-y-6">
            <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
              <Card className="rounded-lg border-border bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <PieChartIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    Distribuicao por canal
                  </CardTitle>
                  <CardDescription>Conversas agrupadas pela origem real identificada.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isInitialAnalyticsLoading ? (
                    <Skeleton className="h-[310px] w-full rounded-lg bg-muted" />
                  ) : (
                    <div className="relative h-[310px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={channelsChartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={78}
                            outerRadius={112}
                            paddingAngle={rawChannelsData.length ? 3 : 0}
                            stroke="none"
                          >
                            {channelsChartData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload as { name: string; value: number; color: string };
                              return (
                                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                                  <div className="font-semibold" style={{ color: data.color }}>
                                    {data.name}
                                  </div>
                                  <div className="mt-1 text-muted-foreground">{formatNumber(data.value)} conversas</div>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-3xl font-semibold text-foreground">{formatNumber(channelTotal)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">conversas</div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-lg border-border bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Redes e canais
                  </CardTitle>
                  <CardDescription>WhatsApp, Instagram, Messenger, Telegram e outros canais.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isInitialAnalyticsLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-16 w-full rounded-lg bg-muted" />
                      ))}
                    </div>
                  ) : rawChannelsData.length ? (
                    <div className="space-y-3">
                      {rawChannelsData.map((channel) => {
                        const percent = getChannelPercent(channel.value, channelTotal);

                        return (
                          <div key={channel.name} className="rounded-lg border border-border bg-background/70 p-4">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                                  <ChannelIcon name={channel.name} color={channel.color} className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground">{channel.name}</p>
                                  <p className="text-xs text-muted-foreground">{formatNumber(channel.value)} conversas</p>
                                </div>
                              </div>
                              <span className="shrink-0 text-sm font-semibold text-foreground">{formatPercent(percent)}</span>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: channel.color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyPanel label="Nenhuma rede social foi identificada no periodo selecionado." />
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="team" className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Atendentes ativos"
                value={formatNumber(performanceToDisplay.length)}
                description="Com conversas no periodo"
                icon={UserRoundCheck}
                tone="blue"
                loading={isInitialAgentLoading}
              />
              <StatCard
                title="Atendimentos da equipe"
                value={formatNumber(displayedChats)}
                description={`${formatNumber(displayedResolved)} resolvidos`}
                icon={Users}
                tone="emerald"
                loading={isInitialAgentLoading}
              />
              <StatCard
                title="Resolucao da equipe"
                value={formatPercent(displayedResolution)}
                description="Baseada nos atendimentos filtrados"
                icon={CheckCircle2}
                tone="amber"
                loading={isInitialAgentLoading}
              />
              <StatCard
                title="Maior volume"
                value={topAgent?.agent_name || 'N/A'}
                description={topAgent ? `${formatNumber(topAgent.total_chats)} atendimentos` : 'Sem dados'}
                icon={Award}
                tone="violet"
                loading={isInitialAgentLoading}
              />
            </section>

            <Card className="rounded-lg border-border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Award className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                  {selectedAgentName ? `Performance: ${selectedAgentName}` : 'Ranking de atendimento'}
                </CardTitle>
                <CardDescription>Conversas, resolucao e tempo medio de resposta por atendente.</CardDescription>
              </CardHeader>
              <CardContent>
                <AgentPerformanceTable performance={performanceToDisplay} loading={isInitialAgentLoading} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="conversion" className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title={conversionCounterMode === 'unique_converted_contacts' ? 'Leads convertidos' : 'Oportunidades ganhas'}
                value={formatNumber(conversionCounterValue)}
                description={`${formatPercent(conversionRate)} sobre conversas do periodo`}
                icon={Target}
                tone="emerald"
                loading={isInitialConversionLoading}
              />
              <StatCard
                title="Receita convertida"
                value={formatBRL(conversionMetrics?.totalRevenue || 0)}
                description="Somatorio de negocios ganhos"
                icon={TrendingUp}
                tone="blue"
                loading={isInitialConversionLoading}
              />
              <StatCard
                title="Leads unicos"
                value={formatNumber(conversionMetrics?.convertedContacts ?? 0)}
                description="Contatos marcados como convertidos"
                icon={UserRoundCheck}
                tone="violet"
                loading={isInitialConversionLoading}
              />
              <StatCard
                title="Deals ganhos"
                value={formatNumber(conversionMetrics?.wonDeals ?? 0)}
                description="Oportunidades fechadas como ganhas"
                icon={CheckCircle2}
                tone="amber"
                loading={isInitialConversionLoading}
              />
            </section>

            <Card className="rounded-lg border-border bg-card shadow-sm">
              <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    Conversoes e receita
                  </CardTitle>
                  <CardDescription>Resultados comerciais gerados dentro do filtro atual.</CardDescription>
                </div>
                <Select value={conversionCounterMode} onValueChange={handleCounterModeChange}>
                  <SelectTrigger className="h-10 w-full border-border bg-background text-sm text-foreground sm:w-[260px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="won_deals">Contar oportunidades ganhas</SelectItem>
                    <SelectItem value="unique_converted_contacts">Contar leads convertidos</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {isInitialConversionLoading ? (
                  <Skeleton className="h-[240px] w-full rounded-lg bg-muted" />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Contador principal
                      </div>
                      <p className="mt-4 text-4xl font-semibold text-foreground">{formatNumber(conversionCounterValue)}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {conversionCounterMode === 'unique_converted_contacts'
                          ? 'Leads unicos convertidos'
                          : 'Oportunidades ganhas'}
                      </p>
                      {isSavingConversionMode && <p className="mt-3 text-xs text-muted-foreground">salvando metodo...</p>}
                    </div>

                    <div className="rounded-lg border border-border bg-background/70 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Ultima conversao
                      </div>
                      <p className="mt-4 text-lg font-semibold text-foreground">
                        {conversionMetrics?.lastConversionAt
                          ? format(new Date(conversionMetrics.lastConversionAt), "dd/MM/yyyy 'as' HH:mm")
                          : 'Nenhuma no periodo'}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">{formatPercent(conversionRate)} de conversao sobre conversas.</p>
                    </div>

                    <div className="rounded-lg border border-border bg-background/70 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        Contexto do funil
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Conversas</span>
                          <span className="font-semibold text-foreground">{formatNumber(totalConversations)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Novos contatos</span>
                          <span className="font-semibold text-foreground">{formatNumber(analyticsData?.newContacts ?? 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Receita</span>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                            {formatBRL(conversionMetrics?.totalRevenue || 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
