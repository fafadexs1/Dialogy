import 'server-only';

import { readTeamCandidates } from './candidates';
import { decideOpportunity, distributionMode } from './policy';
import { db } from '@/lib/db';
import {
    buildPresenceAvailabilitySql,
    getPresenceRecentActivitySeconds,
    getPresenceTtlSeconds,
} from '@/lib/presence';

import {
    evaluateTeamBusinessHours,
    type TeamAvailabilityReason,
} from './team-availability';

export type WorkspaceTeamAvailability = {
    teamId: string;
    teamName: string;
    color: string | null;
    roleId: string | null;
    tagId: string | null;
    totalMembers: number;
    onlineMembers: number;
    acceptingMembers: number;
    assignableMembers: number;
    activeChats: number;
    effectiveLoad: number;
    protectedMembers: number;
    previewSelectedAgentId: string | null;
    /** Carteira ativa dividida pelos agentes que podem receber. CritÃ©rio de escolha entre equipes. */
    loadPerAssignableAgent: number;
    isWithinBusinessHours: boolean;
    availability: TeamAvailabilityReason;
};

/**
 * Retrato de transferibilidade de todas as equipes do workspace, avaliado com
 * as mesmas regras que o balanceador aplica na hora de atribuir.
 *
 * Um Ãºnico lugar decide isso porque as trÃªs leituras que existiam antes â€” a
 * contagem do diÃ¡logo de transferÃªncia, o prÃ©-check da rota de API e a escolha
 * de equipe da transferÃªncia automÃ¡tica â€” usavam critÃ©rios diferentes entre si
 * e diferentes do balanceador. Qualquer divergÃªncia aqui volta como "tem 2
 * agentes ativos mas nÃ£o hÃ¡ ninguÃ©m para transferir".
 */
export async function getWorkspaceTeamAvailability(
    workspaceId: string
): Promise<WorkspaceTeamAvailability[]> {
    const ttlSeconds = getPresenceTtlSeconds();
    const recentActivitySeconds = getPresenceRecentActivitySeconds();
    const availabilitySql = buildPresenceAvailabilitySql('uwp', '$2', '$3');

    const res = await db.query(
        `
        SELECT
            t.id,
            t.name,
            t.color,
            t.role_id,
            t.tag_id,
            w.timezone,
            COALESCE(bh.entries, '[]'::json) AS "businessHours",
            COALESCE(se.entries, '[]'::json) AS "scheduleExceptions",
            COALESCE(members.total_count, 0) AS "totalCount",
            COALESCE(members.online_count, 0) AS "onlineCount",
            COALESCE(members.accepting_count, 0) AS "acceptingCount",
            COALESCE(members.assignable_count, 0) AS "assignableCount",
            COALESCE(members.assignable_chats, 0) AS "assignableChats"
        FROM teams t
        JOIN workspaces w ON w.id = t.workspace_id
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                'day_of_week', b.day_of_week,
                'is_enabled', b.is_enabled,
                'start_time', b.start_time,
                'end_time', b.end_time
            )) AS entries
            FROM business_hours b
            WHERE b.team_id = t.id
        ) bh ON TRUE
        -- Janela de tres dias: a data do workspace pode estar a frente ou atras
        -- do CURRENT_DATE do banco. Quem escolhe a excecao valida e o avaliador,
        -- ja no fuso do workspace.
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                'date', s.date,
                'is_closed', s.is_closed,
                'start_time', s.start_time,
                'end_time', s.end_time
            )) AS entries
            FROM schedule_exceptions s
            WHERE s.team_id = t.id
              AND s.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
        ) se ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS total_count,
                COUNT(*) FILTER (WHERE ${availabilitySql}) AS online_count,
                COUNT(*) FILTER (
                    WHERE ${availabilitySql}
                      AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
                ) AS accepting_count,
                COUNT(*) FILTER (
                    WHERE ${availabilitySql}
                      AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
                ) AS assignable_count,
                COALESCE(SUM(portfolio.active_count) FILTER (
                    WHERE ${availabilitySql}
                      AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
                ), 0) AS assignable_chats
            FROM team_members tm
            LEFT JOIN user_workspace_presence uwp
                ON uwp.user_id = tm.user_id
               AND uwp.workspace_id = t.workspace_id
            LEFT JOIN team_agent_distribution_state ds
                ON ds.workspace_id = t.workspace_id
               AND ds.team_id = t.id
               AND ds.user_id = tm.user_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS active_count
                FROM chats c
                WHERE c.workspace_id = t.workspace_id
                  AND c.agent_id = tm.user_id
                  AND c.status = 'atendimentos'
            ) portfolio ON TRUE
            WHERE tm.team_id = t.id
        ) members ON TRUE
        WHERE t.workspace_id = $1
        ORDER BY t.name
        `,
        [workspaceId, ttlSeconds, recentActivitySeconds]
    );

    return Promise.all(res.rows.map(async (row) => {
        const candidates = await readTeamCandidates(db,{workspaceId,teamId:row.id});
        const preview = decideOpportunity(candidates);
        const protectedMembers = preview.candidates.filter(candidate=>candidate.reason==='eligible').length;
        const effectiveLoad = candidates.filter(candidate=>!candidate.availableReason).reduce((sum,candidate)=>sum+candidate.effectiveLoad,0);
        const totalMembers = Number(row.totalCount) || 0;
        const onlineMembers = Number(row.onlineCount) || 0;
        const acceptingMembers = Number(row.acceptingCount) || 0;
        const assignableMembers = Number(row.assignableCount) || 0;
        const activeChats = Number(row.assignableChats) || 0;

        const schedule = evaluateTeamBusinessHours({
            businessHours: row.businessHours,
            scheduleExceptions: row.scheduleExceptions,
            timezone: row.timezone,
        });

        // Mesma ordem de causas que o balanceador aplicaria, para a interface
        // mostrar o motivo pelo qual o servidor recusaria a transferencia.
        let availability: TeamAvailabilityReason = 'available';
        if (totalMembers === 0) availability = 'no_members';
        else if (!schedule.isOpen) availability = 'outside_business_hours';
        else if (onlineMembers === 0) availability = 'all_offline';
        else if (acceptingMembers === 0) availability = 'not_accepting';

        return {
            teamId: row.id,
            teamName: row.name,
            color: row.color ?? null,
            roleId: row.role_id ?? null,
            tagId: row.tag_id ?? null,
            totalMembers,
            onlineMembers,
            acceptingMembers,
            assignableMembers,
            activeChats, effectiveLoad, protectedMembers,
            previewSelectedAgentId: schedule.isOpen && distributionMode(workspaceId)==='active' ? preview.selection?.agentId ?? null : null,
            loadPerAssignableAgent: effectiveLoad / Math.max(assignableMembers, 1),
            isWithinBusinessHours: schedule.isOpen,
            availability,
        };
    }));
}

/**
 * Equipes que podem receber uma transferÃªncia agora, da menos carregada para a
 * mais carregada. A transferÃªncia automÃ¡tica percorre esta lista em ordem: com
 * uma Ãºnica candidata, uma equipe fechada ou lotada derrubava a transferÃªncia
 * inteira mesmo havendo outra equipe aberta e livre no workspace.
 */
export async function rankAssignableTeams(
    workspaceId: string
): Promise<WorkspaceTeamAvailability[]> {
    const teams = await getWorkspaceTeamAvailability(workspaceId);
    return teams
        .filter((team) => team.availability === 'available')
        .sort((left, right) => {
            const delta = left.loadPerAssignableAgent - right.loadPerAssignableAgent;
            if (Math.abs(delta) > Number.EPSILON) return delta;
            return left.teamId.localeCompare(right.teamId);
        });
}
