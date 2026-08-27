import type { AgentToolAction } from './types';

export type ToolRouterTeam = {
  id: string;
  name: string;
  routingConfig?: {
    enabled?: boolean;
    autoTransfer?: boolean;
    keywords?: string[];
    responseHint?: string | null;
  } | null;
};

export type DeterministicToolRoutingInput = {
  customerMessage: string;
  contactName?: string | null;
  availableTeams: ToolRouterTeam[];
};

export type DeterministicToolRoutingResult = {
  actions: AgentToolAction[];
  matchedReason: string | null;
  responseHint: string | null;
  candidates: ToolRoutingCandidate[];
};

export type ToolRoutingCandidate = {
  toolName: 'transfer_chat';
  team: Pick<ToolRouterTeam, 'id' | 'name'>;
  reason: string;
  source: 'configured_keyword' | 'team_mention';
  matchedText?: string | null;
  responseHint: string;
};

const HANDOFF_VERBS = new Set([
  'falar',
  'fala',
  'conversar',
  'chamar',
  'chama',
  'passar',
  'passa',
  'passe',
  'transferir',
  'transfere',
  'transfira',
  'encaminhar',
  'encaminha',
  'encaminhe',
]);

const HUMAN_TARGETS = new Set([
  'atendente',
  'humano',
  'pessoa',
  'consultor',
  'operador',
  'suporte',
]);

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ') : [];
}

function findSubsequence(tokens: string[], target: string[]): number {
  if (target.length === 0 || target.length > tokens.length) return -1;
  for (let index = 0; index <= tokens.length - target.length; index += 1) {
    if (target.every((token, offset) => tokens[index + offset] === token)) {
      return index;
    }
  }
  return -1;
}

function hasHandoffVerbBefore(tokens: string[], targetStart: number, maxDistance = 7): boolean {
  const from = Math.max(0, targetStart - maxDistance);
  for (let index = targetStart - 1; index >= from; index -= 1) {
    if (HANDOFF_VERBS.has(tokens[index])) return true;
  }
  return false;
}

function hasExplicitHumanTarget(tokens: string[]): boolean {
  return tokens.some((token, index) => HUMAN_TARGETS.has(token) && hasHandoffVerbBefore(tokens, index));
}

function findMentionedTeam(message: string, teams: ToolRouterTeam[]) {
  const normalizedMessage = normalizeSearchText(message);
  if (!normalizedMessage) return null;

  return teams.find((team) => {
    const normalizedName = normalizeSearchText(team.name);
    return normalizedName.length >= 3 && normalizedMessage.includes(normalizedName);
  }) ?? null;
}

function findConfiguredTeam(message: string, teams: ToolRouterTeam[]) {
  const normalizedMessage = normalizeSearchText(message);
  if (!normalizedMessage) return null;

  for (const team of teams) {
    const config = team.routingConfig;
    if (!config?.enabled || config.autoTransfer === false) continue;

    const keywords = (config.keywords || [])
      .map((keyword) => normalizeSearchText(keyword))
      .filter((keyword) => keyword.length >= 2);

    const matchedKeyword = keywords.find((keyword) => normalizedMessage.includes(keyword));
    if (matchedKeyword) {
      return { team, matchedKeyword };
    }
  }

  return null;
}

function findHumanHandoffTeam(teams: ToolRouterTeam[]) {
  return teams.find((candidate) => candidate.routingConfig?.enabled && candidate.routingConfig.autoTransfer !== false)
    ?? teams[0]
    ?? null;
}

export function shouldHandoffToHuman(message: string) {
  const tokens = tokenize(message);
  if (tokens.length === 0) return false;

  const normalized = tokens.join(' ');
  if (/\bnao quero falar com (robo|bot|ia)\b/i.test(normalized)) {
    return true;
  }

  return hasExplicitHumanTarget(tokens);
}

export function hasExplicitTeamHandoff(message: string, team: Pick<ToolRouterTeam, 'name'> | null | undefined) {
  if (!team?.name) return false;
  const tokens = tokenize(message);
  const teamTokens = tokenize(team.name);
  if (tokens.length === 0 || teamTokens.length === 0) return false;

  const targetStart = findSubsequence(tokens, teamTokens);
  if (targetStart < 0) return false;

  return hasHandoffVerbBefore(tokens, targetStart);
}

function buildNoteContent(input: {
  reason: string;
  customerMessage: string;
  contactName?: string | null;
}) {
  const prefix = input.contactName ? `${input.contactName}: ` : '';
  const compactMessage = input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 180);
  return `${prefix}${compactMessage}. Motivo do roteamento: ${input.reason}.`;
}

export function routeDeterministicAgentTools(
  input: DeterministicToolRoutingInput
): DeterministicToolRoutingResult {
  const message = input.customerMessage.replace(/\s+/g, ' ').trim();
  if (!message || input.availableTeams.length === 0) {
    return { actions: [], matchedReason: null, responseHint: null, candidates: [] };
  }

  const candidates: ToolRoutingCandidate[] = [];

  const configuredTeam = findConfiguredTeam(message, input.availableTeams);
  const configuredTeamIsExplicit = configuredTeam
    ? shouldHandoffToHuman(message) || hasExplicitTeamHandoff(message, configuredTeam.team)
    : false;
  if (configuredTeam && configuredTeamIsExplicit) {
    const reason = `Mensagem correspondeu a regra configurada da equipe ${configuredTeam.team.name}.`;
    return {
      matchedReason: reason,
      responseHint:
        configuredTeam.team.routingConfig?.responseHint ||
        `Vou encaminhar seu atendimento para a equipe ${configuredTeam.team.name}.`,
      candidates,
      actions: [
        {
          type: 'add_internal_note',
          reason,
          payload: {
            content: buildNoteContent({
              reason,
              customerMessage: message,
              contactName: input.contactName,
            }),
          },
        },
        {
          type: 'transfer_chat',
          reason,
          payload: { teamId: configuredTeam.team.id },
        },
      ],
    };
  }
  if (configuredTeam) {
    candidates.push({
      toolName: 'transfer_chat',
      team: { id: configuredTeam.team.id, name: configuredTeam.team.name },
      reason: `Mensagem correspondeu a keyword "${configuredTeam.matchedKeyword}" da equipe ${configuredTeam.team.name}, mas nao houve pedido explicito de transferencia.`,
      source: 'configured_keyword',
      matchedText: configuredTeam.matchedKeyword,
      responseHint:
        configuredTeam.team.routingConfig?.responseHint ||
        `Vou encaminhar seu atendimento para a equipe ${configuredTeam.team.name}.`,
    });
  }

  const mentionedTeam = findMentionedTeam(message, input.availableTeams);
  if (mentionedTeam && hasExplicitTeamHandoff(message, mentionedTeam)) {
    const reason = `Cliente mencionou diretamente a equipe ${mentionedTeam.name}.`;
    return {
      matchedReason: reason,
      responseHint: `Vou encaminhar seu atendimento para a equipe ${mentionedTeam.name}.`,
      candidates,
      actions: [
        {
          type: 'add_internal_note',
          reason,
          payload: {
            content: buildNoteContent({
              reason,
              customerMessage: message,
              contactName: input.contactName,
            }),
          },
        },
        {
          type: 'transfer_chat',
          reason,
          payload: { teamId: mentionedTeam.id },
        },
      ],
    };
  }
  if (mentionedTeam) {
    candidates.push({
      toolName: 'transfer_chat',
      team: { id: mentionedTeam.id, name: mentionedTeam.name },
      reason: `Cliente mencionou a equipe ${mentionedTeam.name}, mas nao houve pedido explicito de transferencia.`,
      source: 'team_mention',
      matchedText: mentionedTeam.name,
      responseHint: `Vou encaminhar seu atendimento para a equipe ${mentionedTeam.name}.`,
    });
  }

  if (shouldHandoffToHuman(message)) {
    const handoffTeam = findHumanHandoffTeam(input.availableTeams);
    if (handoffTeam) {
      const reason = `Cliente pediu atendimento humano sem indicar setor.`;
      return {
        matchedReason: reason,
        responseHint: `Vou encaminhar seu atendimento para a equipe ${handoffTeam.name}.`,
        candidates,
        actions: [
          {
            type: 'add_internal_note',
            reason,
            payload: {
              content: buildNoteContent({
                reason,
                customerMessage: message,
                contactName: input.contactName,
              }),
            },
          },
          {
            type: 'transfer_chat',
            reason,
            payload: { teamId: handoffTeam.id },
          },
        ],
      };
    }
  }

  return { actions: [], matchedReason: null, responseHint: null, candidates };
}
