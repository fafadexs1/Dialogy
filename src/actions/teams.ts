
'use server';

import { db } from '@/lib/db';
import type { Team, User, BusinessHour, Role } from '@/lib/types';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';

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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { teams: [], error: "Usuário não autenticado." };

    if (!await hasPermission(session.user.id, workspaceId, 'teams:view')) {
         return { teams: [], error: "Acesso não autorizado." };
    }

    try {
        const teamsRes = await db.query('SELECT id, name, color, role_id FROM teams WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
        
        const teams: Team[] = [];

        for (const row of teamsRes.rows) {
            const membersRes = await db.query(`
                SELECT u.id, u.full_name as name, u.avatar_url as avatar
                FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                WHERE tm.team_id = $1
            `, [row.id]);

            const businessHoursRes = await db.query(`
                SELECT day_of_week as day, is_enabled as "isEnabled", start_time as "startTime", end_time as "endTime"
                FROM business_hours
                WHERE team_id = $1
            `, [row.id]);

            teams.push({
                id: row.id,
                name: row.name,
                color: row.color,
                roleId: row.role_id,
                members: membersRes.rows,
                businessHours: businessHoursRes.rows,
            });
        }
        
        return { teams };

    } catch (error) {
        console.error("Erro ao buscar equipes:", error);
        return { teams: [], error: "Falha ao buscar dados das equipes no banco de dados." };
    }
}

export async function createTeam(data: { workspaceId: string, name: string, roleId: string }): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };
    
    if (!await hasPermission(session.user.id, data.workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para criar equipes." };
    }

    try {
        await db.query(
            'INSERT INTO teams (workspace_id, name, role_id) VALUES ($1, $2, $3)',
            [data.workspaceId, data.name, data.roleId]
        );
        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao criar equipe:", error);
        return { success: false, error: "Falha ao criar a equipe." };
    }
}

export async function updateTeam(teamId: string, data: Partial<Pick<Team, 'name' | 'color' | 'roleId'>>): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };
    
    // Need workspaceId to check permission
    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;

    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para editar equipes." };
    }

    try {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const setClauses = fields.map((field, index) => `${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)} = $${index + 1}`).join(', ');

        const query = `UPDATE teams SET ${setClauses} WHERE id = $${fields.length + 1}`;
        await db.query(query, [...values, teamId]);
        
        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar equipe:", error);
        return { success: false, error: "Falha ao atualizar a equipe." };
    }
}

export async function deleteTeam(teamId: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para remover equipes." };
    }

    try {
        await db.query('DELETE FROM teams WHERE id = $1', [teamId]);
        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover equipe:", error);
        return { success: false, error: "Falha ao remover a equipe." };
    }
}


export async function addTeamMember(teamId: string, userId: string): Promise<{ success: boolean; error?: string }> {
     const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para gerenciar membros da equipe." };
    }
    
    try {
        await db.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [teamId, userId]);
        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao adicionar membro:", error);
        return { success: false, error: "Falha ao adicionar membro à equipe." };
    }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<{ success: boolean; error?: string }> {
     const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(session.user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para gerenciar membros da equipe." };
    }

    try {
        await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover membro:", error);
        return { success: false, error: "Falha ao remover membro da equipe." };
    }
}

export async function updateBusinessHours(teamId: string, day: string, data: Partial<Pick<BusinessHour, 'isEnabled' | 'startTime' | 'endTime'>>): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
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
            const dbField = { isEnabled: 'is_enabled', startTime: 'start_time', endTime: 'end_time' }[field] || field;
            return `${dbField} = $${index + 1}`;
        }).join(', ');
        
        const query = `UPDATE business_hours SET ${setClauses} WHERE team_id = $${fields.length + 1} AND day_of_week = $${fields.length + 2}`;
        await db.query(query, [...values, teamId, day]);

        revalidatePath('/team');
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar horário:", error);
        return { success: false, error: "Falha ao atualizar o horário de atendimento." };
    }
}
