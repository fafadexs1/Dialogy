import Link from 'next/link';
import { Loader2, MessageSquare, Save, Settings2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Workspace } from '@/lib/types';
import { getAiModelLabel, type AiModelCatalogEntry } from '@/lib/ai-models';

interface AutopilotSettingsProps {
  agentName: string;
  setAgentName: (name: string) => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  knowledgeBase: string;
  setKnowledgeBase: (kb: string) => void;
  defaultFallbackReply: string;
  setDefaultFallbackReply: (reply: string) => void;
  escalationPolicy: string;
  setEscalationPolicy: (policy: string) => void;
  closingPolicy: string;
  setClosingPolicy: (policy: string) => void;
  isActive: boolean;
  setIsActive: (active: boolean) => void;
  isPrivate: boolean;
  setIsPrivate: (privateAgent: boolean) => void;
  isPrimary: boolean;
  onSetPrimary: () => void;
  geminiApiKey: string;
  setGeminiApiKey?: (key: string) => void;
  hasGlobalKey?: boolean;
  workspaceHasGeminiConfig?: boolean;
  workspaceDefaultAiModel?: string | null;
  modelOptions: AiModelCatalogEntry[];
  onSave: () => void;
  isSaving: boolean;
  onDelete: () => void;
  workspace?: Workspace | null;
}

export function AutopilotSettings({
  agentName,
  setAgentName,
  aiModel,
  setAiModel,
  knowledgeBase,
  setKnowledgeBase,
  defaultFallbackReply,
  setDefaultFallbackReply,
  escalationPolicy,
  setEscalationPolicy,
  closingPolicy,
  setClosingPolicy,
  isActive,
  setIsActive,
  isPrivate,
  setIsPrivate,
  isPrimary,
  onSetPrimary,
  geminiApiKey,
  setGeminiApiKey,
  hasGlobalKey = false,
  workspaceHasGeminiConfig = false,
  workspaceDefaultAiModel = null,
  modelOptions,
  onSave,
  isSaving,
  onDelete,
  workspace,
}: AutopilotSettingsProps) {
  const hasWorkspaceFallback = hasGlobalKey || workspaceHasGeminiConfig;
  const effectiveModelOptions = modelOptions.some((model) => model.id === aiModel)
    ? modelOptions
    : [
        {
          id: aiModel,
          label: `${getAiModelLabel(aiModel, modelOptions)} (modelo atual)`,
          provider: 'other',
          enabled: true,
        },
        ...modelOptions,
      ];

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/30">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-primary p-3 text-primary-foreground">
              <Settings2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl text-foreground">Configurações gerais</CardTitle>
              <CardDescription>
                Controle identidade, modelo, prompt base e herança de configuração do workspace.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 p-6 sm:p-8 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <div className="grid min-w-0 gap-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Nome do agente</Label>
                <Input
                  id="agent-name"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Ex: Consultor de Vendas"
                />
              </div>

              <div className="space-y-2">
                <Label>Modelo de IA</Label>
                <Select value={aiModel} onValueChange={setAiModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {effectiveModelOptions.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Escolha entre os modelos liberados no superadmin. Se o catálogo mudar, esta lista acompanha sem precisar editar código.
                </p>
                {!modelOptions.some((model) => model.id === aiModel) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    O modelo atualmente salvo não está mais no catálogo ativo. Você ainda pode visualizar e trocar esse valor antes de salvar.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="knowledge-base">Persona do agente</Label>
              <Textarea
                id="knowledge-base"
                value={knowledgeBase}
                onChange={(e) => setKnowledgeBase(e.target.value)}
                placeholder="Descreva quem é este agente, como deve falar, quais limites deve respeitar e o objetivo operacional."
                className="min-h-[180px] resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Esse texto funciona como prompt base da operação. Seja específico no tom, política de resposta e critérios de escalonamento.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fallback-reply">Resposta de fallback</Label>
              <Textarea
                id="fallback-reply"
                value={defaultFallbackReply}
                onChange={(e) => setDefaultFallbackReply(e.target.value)}
                placeholder="Ex: Para te responder com segurança, preciso encaminhar este atendimento para um especialista."
                className="min-h-[110px] resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Use quando a IA não tiver informação suficiente ou quando a pergunta sair do escopo definido.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="escalation-policy">Política de escalonamento</Label>
                <Textarea
                  id="escalation-policy"
                  value={escalationPolicy}
                  onChange={(e) => setEscalationPolicy(e.target.value)}
                  placeholder="Ex: transfira para humano quando houver reclamação grave, pedido de cancelamento, assunto financeiro sensível ou quando não tiver certeza."
                  className="min-h-[130px] resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Defina quando a IA deve parar de resolver sozinha e envolver um atendente humano.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="closing-policy">Política de encerramento</Label>
                <Textarea
                  id="closing-policy"
                  value={closingPolicy}
                  onChange={(e) => setClosingPolicy(e.target.value)}
                  placeholder="Ex: pode encerrar somente após confirmação clara do cliente ou quando a dúvida estiver resolvida e o cliente se despedir."
                  className="min-h-[130px] resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Oriente em quais condições o atendimento pode ser considerado resolvido.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gemini-api-key">Chave Gemini personalizada</Label>
              <Input
                id="gemini-api-key"
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey && setGeminiApiKey(e.target.value)}
                placeholder="Deixe vazio para usar a configuração global do workspace"
              />
              <p className="text-xs text-muted-foreground">
                {hasWorkspaceFallback
                  ? `Se vazio, o agente herda a configuração global do workspace${workspaceDefaultAiModel ? ` (${getAiModelLabel(workspaceDefaultAiModel, modelOptions)})` : ''}.`
                  : 'Nenhuma chave global foi encontrada. Preencha uma chave aqui ou configure Integrações > Gemini.'}
              </p>
            </div>

          </div>

          <div className="grid gap-4 self-start">
            <div className="rounded-[24px] border border-border bg-muted/30 p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">
                  {getAiModelLabel(aiModel, modelOptions)}
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  {isPrivate ? 'Privado' : 'Público'}
                </Badge>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between rounded-2xl border border-border bg-background/80 px-4 py-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground">Status do agente</Label>
                    <p className="text-xs text-muted-foreground">Pausar interrompe respostas da IA.</p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border bg-background/80 px-4 py-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground">Privacidade</Label>
                    <p className="text-xs text-muted-foreground">Agentes privados são visíveis só para você.</p>
                  </div>
                  <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border bg-background/80 px-4 py-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground">Agente principal</Label>
                    <p className="text-xs text-muted-foreground">Usado como padrão quando nenhum outro for definido.</p>
                  </div>
                  <Switch checked={isPrimary} onCheckedChange={(checked) => checked && onSetPrimary()} disabled={isPrimary} />
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-muted/30 p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <MessageSquare className="h-4 w-4 text-primary" />
                Mensagens globais do workspace
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-border bg-background/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Encerramento</div>
                  <p className="mt-2 text-sm text-foreground">
                    {workspace?.closeMessageTemplate || 'Não definida'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-background/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Transferência</div>
                  <p className="mt-2 text-sm text-foreground">
                    {workspace?.transferTeamMessageTemplate || 'Não definida'}
                  </p>
                </div>
                <Link href="/settings/workspace" className="text-xs font-medium text-primary hover:underline">
                  Editar mensagens do workspace →
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="overflow-hidden rounded-[28px] border border-destructive/20 bg-destructive/5 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">Zona de perigo</h3>
              <p className="text-sm text-muted-foreground">
                A exclusão é permanente e remove o agente, o conhecimento indexado e o histórico operacional associado.
              </p>
            </div>
            <Button variant="destructive" onClick={onDelete} className="rounded-full px-6">
              Excluir este agente
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <CardContent className="flex h-full flex-col justify-between gap-4 p-6">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">Salvar agora</h3>
              <p className="text-sm text-muted-foreground">
                Use este atalho ao final do formulário para persistir nome, modelo, prompt e chave personalizada.
              </p>
            </div>
            <Button onClick={onSave} disabled={isSaving} className="rounded-full">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar ajustes
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
