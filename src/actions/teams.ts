
'use server';

import { db } from '@/lib/db';
import type { Team, User, BusinessHour, Role } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

// Helper function to check for admin permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}

export async function getTeams(workspaceId: string): Promise<{ teams: Team[], error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { teams: [], error: "Usuário não autenticado." };

    if (!await hasPermission(session.user.id, workspaceId, 'teams:view')) {
         return { teams: [], error: "Acesso não autorizado." };
    }

    try {
        const teamsRes = await db.query(`
            SELECT
                t.id,
                t.name,
                t.color,
                t.role_id,
                t.tag_id,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', u.id,
                            'name', u.full_name,
                            'avatar', u.avatar_url
                        )
                    )
                    FROM team_members tm
                    JOIN users u ON tm.user_id = u.id
                    WHERE tm.team_id = t.id),
                    '[]'::json
                ) as members,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'day', bh.day_of_week,
                            'isEnabled', bh.is_enabled,
                            'startTime', bh.start_time,
                            'endTime', bh.end_time
                        )
                    )
                    FROM business_hours bh
                    WHERE bh.team_id = t.id),
                    '[]'::json
                ) as "businessHours"
            FROM teams t
            WHERE t.workspace_id = $1
            ORDER BY t.name;
        `, [workspaceId]);

        return { teams: teamsRes.rows };

    } catch (error) {
        console.error("Erro ao buscar equipes:", error);
        return { teams: [], error: "Falha ao buscar dados das equipes no banco de dados." };
    }
}

export async function createTeam(data: { workspaceId: string, name: string, roleId: string }): Promise<{ team: Team | null; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { team: null, error: "Usuário não autenticado." };
    
    if (!await hasPermission(session.user.id, data.workspaceId, 'teams:edit')) {
         return { team: null, error: "Você não tem permissão para criar equipes." };
    }

    try {
        const teamRes = await db.query(
            'INSERT INTO teams (workspace_id, name, role_id, owner_id) VALUES ($1, $2, $3, $4) RETURNING id, name, color, role_id, tag_id',
            [data.workspaceId, data.name, data.roleId, session.user.id]
        );
        
        const newTeam = teamRes.rows[0];

        const businessHoursRes = await db.query(
             `SELECT day_of_week as day, is_enabled as "isEnabled", start_time as "startTime", end_time as "endTime"
                FROM business_hours
                WHERE team_id = $1`,
            [newTeam.id]
        );

        const fullTeam: Team = {
            id: newTeam.id,
            name: newTeam.name,
            color: newTeam.color,
            roleId: newTeam.role_id,
            tagId: newTeam.tag_id,
            members: [],
            businessHours: businessHoursRes.rows
        }

        return { team: fullTeam };
    } catch (error) {
        console.error("Erro ao criar equipe:", error);
        return { team: null, error: "Falha ao criar a equipe." };
    }
}

export async function updateTeam(teamId: string, data: Partial<Pick<Team, 'name' | 'color' | 'roleId' | 'tagId'>>): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };
    
    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;

    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para editar equipes." };
    }

    try {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const setClauses = fields.map((field, index) => {
            const dbField = { roleId: 'role_id', tagId: 'tag_id' }[field] || field;
            return `${dbField} = $${index + 1}`;
        }).join(', ');

        if (!setClauses) return { success: true };

        const query = `UPDATE teams SET ${setClauses} WHERE id = $${fields.length + 1}`;
        
        // Handle case where tagId might be an empty string from the form, should be NULL
        const finalValues = values.map(val => val === '' ? null : val);

        await db.query(query, [...finalValues, teamId]);
        
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar equipe:", error);
        return { success: false, error: "Falha ao atualizar a equipe." };
    }
}

export async function deleteTeam(teamId: string): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para remover equipes." };
    }

    try {
        await db.query('DELETE FROM teams WHERE id = $1', [teamId]);
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover equipe:", error);
        return { success: false, error: "Falha ao remover a equipe." };
    }
}


export async function addTeamMember(teamId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para gerenciar membros da equipe." };
    }
    
    try {
        await db.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [teamId, userId]);
        return { success: true };
    } catch (error) {
        console.error("Erro ao adicionar membro:", error);
        return { success: false, error: "Falha ao adicionar membro à equipe." };
    }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para gerenciar membros da equipe." };
    }

    try {
        await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover membro:", error);
        return { success: false, error: "Falha ao remover membro da equipe." };
    }
}

export async function updateBusinessHours(teamId: string, day: string, data: Partial<Pick<BusinessHour, 'isEnabled' | 'startTime' | 'endTime'>>): Promise<{ success: boolean; error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para editar horários." };
    }
    
    try {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const setClauses = fields.map((field, index) => {
            const dbField = { isEnabled: 'is_enabled', startTime: 'start_time', endTime: 'end_time' }[field as keyof BusinessHour] || field;
            return `${dbField} = $${index + 1}`;
        }).join(', ');
        
        const query = `UPDATE business_hours SET ${setClauses} WHERE team_id = $${fields.length + 1} AND day_of_week = $${fields.length + 2}`;
        await db.query(query, [...values, teamId, day]);

        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar horário:", error);
        return { success: false, error: "Falha ao atualizar o horário de atendimento." };
    }
}

export async function getTeamsWithOnlineMembers(workspaceId: string): Promise<{ teams: (Team & { onlineMembersCount: number })[], error?: string }> {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return { teams: [], error: "Usuário não autenticado." };

    // You might want to add a permission check here as well, e.g., 'teams:view'
    if (!await hasPermission(session.user.id, workspaceId, 'teams:view')) {
        return { teams: [], error: "Acesso não autorizado." };
    }

    try {
        const res = await db.query(`
            SELECT 
                t.id, 
                t.name, 
                t.color, 
                t.role_id,
                t.tag_id,
                COUNT(u.id) FILTER (WHERE u.online = TRUE) as "onlineMembersCount"
            FROM teams t
            LEFT JOIN team_members tm ON t.id = tm.team_id
            LEFT JOIN users u ON tm.user_id = u.id
            WHERE t.workspace_id = $1
            GROUP BY t.id
            ORDER BY t.name;
        `, [workspaceId]);

        const teams = res.rows.map(row => ({
            id: row.id,
            name: row.name,
            color: row.color,
            roleId: row.role_id,
            tagId: row.tag_id,
            members: [], // This function doesn't need to return all members
            businessHours: [], // or business hours
            onlineMembersCount: parseInt(row.onlineMembersCount, 10) || 0,
        }));

        return { teams };

    } catch (error) {
        console.error("Erro ao buscar equipes com membros online:", error);
        return { teams: [], error: "Falha ao buscar dados das equipes." };
    }
}

    