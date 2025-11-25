import { db } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

export default async function MetaWebhooksPage() {
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
      ORDER BY wl.created_at DESC
      LIMIT 50
    `
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks Meta</h1>
          <p className="text-sm text-muted-foreground">
            Últimos 50 eventos recebidos (Instagram/Messenger). Apenas usuários superadmin visualizam.
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum webhook registrado</CardTitle>
              <CardDescription>Envie uma mensagem de teste para ver os eventos aqui.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          rows.map((log) => (
            <Card key={log.id} className="border border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      {log.channel_name || 'Sem canal'} · {log.channel_type || '—'}
                    </CardTitle>
                    <CardDescription>
                      {log.source} · {log.event || 'sem evento'} · {formatDate(log.created_at)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={log.direction === 'outgoing' ? 'secondary' : 'default'}>
                      {log.direction || 'incoming'}
                    </Badge>
                    <Badge variant={log.status_code && log.status_code >= 400 ? 'destructive' : 'outline'}>
                      {log.status_code ?? '—'}
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
