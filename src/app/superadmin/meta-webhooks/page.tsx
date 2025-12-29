import { db } from '@/lib/db';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

type WebhookLogRow = {
  id: string;
  source: string;
  event: string | null;
  status_code: number | null;
  direction: string | null;
  created_at: string;
  payload: any;
  response_body: any;
  channel_name: string | null;
  channel_type: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;
type SearchParamsInput = SearchParams | URLSearchParams | Promise<SearchParams | URLSearchParams>;

const allowedSources = new Set(['meta-instagram', 'meta-messenger']);
const allowedDirections = new Set(['incoming', 'outgoing']);
const allowedStatuses = new Set(['ok', 'error', 'missing']);

function formatDate(date: string) {
  return new Date(date).toLocaleString('pt-BR');
}

function stringify(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MetaWebhooksPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const resolvedParams = await Promise.resolve(searchParams);
  const params: SearchParams =
    resolvedParams instanceof URLSearchParams
      ? Object.fromEntries(resolvedParams.entries())
      : resolvedParams || {};
  const rawQuery = (normalizeParam(params.q) || '').trim();
  const rawSource = normalizeParam(params.source) || '';
  const rawDirection = normalizeParam(params.direction) || '';
  const rawStatus = normalizeParam(params.status) || '';
  const rawPage = normalizeParam(params.page) || '1';
  const rawPerPage = normalizeParam(params.perPage) || '50';

  const q = rawQuery;
  const source = allowedSources.has(rawSource) ? rawSource : '';
  const direction = allowedDirections.has(rawDirection) ? rawDirection : '';
  const status = allowedStatuses.has(rawStatus) ? rawStatus : '';

  const perPage = Math.min(200, Math.max(10, Number(rawPerPage) || 50));
  let page = Math.max(1, Number(rawPage) || 1);

  const filters: string[] = [];
  const filterParams: Array<string | number> = [];
  let index = 1;

  if (q) {
    filterParams.push(`%${q}%`);
    filters.push(`(
      wl.id::text ILIKE $${index}
      OR wl.source ILIKE $${index}
      OR wl.event ILIKE $${index}
      OR wl.direction ILIKE $${index}
      OR mc.name ILIKE $${index}
      OR mc.type ILIKE $${index}
      OR wl.payload::text ILIKE $${index}
      OR wl.response_body::text ILIKE $${index}
    )`);
    index += 1;
  }

  if (source) {
    filterParams.push(source);
    filters.push(`wl.source = $${index}`);
    index += 1;
  }

  if (direction) {
    filterParams.push(direction);
    filters.push(`wl.direction = $${index}`);
    index += 1;
  }

  if (status === 'ok') {
    filters.push('wl.status_code < 400');
  }

  if (status === 'error') {
    filters.push('wl.status_code >= 400');
  }

  if (status === 'missing') {
    filters.push('wl.status_code IS NULL');
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const countResult = await db.query<{ total: number; errors: number }>(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE wl.status_code >= 400)::int AS errors
      FROM webhook_logs wl
      LEFT JOIN meta_channels mc ON mc.id = wl.channel_id
      ${whereClause}
    `,
    filterParams
  );

  const total = countResult.rows[0]?.total ?? 0;
  const errorCount = countResult.rows[0]?.errors ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(page, totalPages);

  const offset = (page - 1) * perPage;
  const dataParams = [...filterParams, perPage, offset];

  const { rows } = await db.query<WebhookLogRow>(
    `
      SELECT 
        wl.id,
        wl.source,
        wl.event,
        wl.status_code,
        wl.direction,
        wl.created_at,
        wl.payload,
        wl.response_body,
        mc.name as channel_name,
        mc.type as channel_type
      FROM webhook_logs wl
      LEFT JOIN meta_channels mc ON mc.id = wl.channel_id
      ${whereClause}
      ORDER BY wl.created_at DESC
      LIMIT $${filterParams.length + 1}
      OFFSET $${filterParams.length + 2}
    `,
    dataParams
  );

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + rows.length, total);

  const baseQuery = new URLSearchParams();
  if (q) baseQuery.set('q', q);
  if (source) baseQuery.set('source', source);
  if (direction) baseQuery.set('direction', direction);
  if (status) baseQuery.set('status', status);
  baseQuery.set('perPage', String(perPage));

  const buildPageHref = (pageValue: number) => {
    const nextParams = new URLSearchParams(baseQuery);
    nextParams.set('page', String(pageValue));
    return `/superadmin/meta-webhooks?${nextParams.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks Meta</h1>
          <p className="text-sm text-muted-foreground">
            Todos os eventos recebidos (Instagram/Messenger) com busca e paginacao.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Total: {total}</Badge>
          <Badge variant={errorCount > 0 ? 'destructive' : 'outline'}>Erros: {errorCount}</Badge>
        </div>
      </div>

      <Card className="border border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>
            Busque por id, evento, source, canal ou conteudo de payload/response.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.6fr_auto_auto]">
            <input type="hidden" name="page" value="1" />
            <Input name="q" placeholder="Buscar..." defaultValue={q} />
            <select
              name="source"
              defaultValue={source}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Fonte (todas)</option>
              <option value="meta-instagram">Instagram</option>
              <option value="meta-messenger">Messenger</option>
            </select>
            <select
              name="direction"
              defaultValue={direction}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Direcao (todas)</option>
              <option value="incoming">Incoming</option>
              <option value="outgoing">Outgoing</option>
            </select>
            <select
              name="status"
              defaultValue={status}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Status (todos)</option>
              <option value="ok">OK</option>
              <option value="error">Erro</option>
              <option value="missing">Sem status</option>
            </select>
            <select
              name="perPage"
              defaultValue={String(perPage)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
            <Button type="submit">Buscar</Button>
            <Button variant="outline" asChild>
              <Link href="/superadmin/meta-webhooks">Limpar</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-muted-foreground">
        <div>
          Mostrando {showingFrom}-{showingTo} de {total}
        </div>
        <div className="flex items-center gap-2">
          <span>
            Pagina {page} de {totalPages}
          </span>
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={buildPageHref(page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Anterior
            </Button>
          )}
          {page < totalPages ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={buildPageHref(page + 1)}>Proxima</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Proxima
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum webhook encontrado</CardTitle>
              <CardDescription>
                Ajuste os filtros ou envie uma mensagem de teste para gerar eventos.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          rows.map((log) => (
            <Card key={log.id} className="border border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      {log.channel_name || 'Sem canal'} - {log.channel_type || 'n/a'}
                    </CardTitle>
                    <CardDescription>
                      {log.source} - {log.event || 'sem evento'} - {formatDate(log.created_at)}
                    </CardDescription>
                    <CardDescription>ID: {log.id}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={log.direction === 'outgoing' ? 'secondary' : 'default'}>
                      {log.direction || 'incoming'}
                    </Badge>
                    <Badge variant={log.status_code && log.status_code >= 400 ? 'destructive' : 'outline'}>
                      {log.status_code ?? 'n/a'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Payload recebido</p>
                  <pre className="bg-muted/60 rounded-md p-3 text-xs overflow-x-auto max-h-64">
                    {stringify(log.payload)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Resposta / body retornado</p>
                  <pre className="bg-muted/60 rounded-md p-3 text-xs overflow-x-auto max-h-64">
                    {stringify(log.response_body)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

