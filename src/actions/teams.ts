

'use server';

import { db } from '@/lib/db';
import type { Team, User, BusinessHour, Role, ScheduleException } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// Helper function to check for admin permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}

export async function getTeams(workspaceId: string): Promise<{ teams: Team[], error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { teams: [], error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'teams:view')) {
         return { teams: [], error: "Acesso não autorizado." };
    }

    try {
        const teamsRes = await db.query(`
            SELECT
                t.id,
                t.name,
                t.color,
                t.role_id as "roleId",
                t.tag_id as "tagId",
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
                            'id', bh.id,
                            'day', bh.day_of_week,
                            'isEnabled', bh.is_enabled,
                            'startTime', bh.start_time,
                            'endTime', bh.end_time
                        ) ORDER BY bh.day_of_week
                    )
                    FROM business_hours bh
                    WHERE bh.team_id = t.id),
                    '[]'::json
                ) as "businessHours",
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', se.id,
                            'team_id', se.team_id,
                            'date', se.date,
                            'description', se.description,
                            'is_closed', se.is_closed,
                            'start_time', se.start_time,
                            'end_time', se.end_time
                        ) ORDER BY se.date ASC
                    )
                    FROM schedule_exceptions se
                    WHERE se.team_id = t.id AND se.date >= CURRENT_DATE),
                    '[]'::json
                ) as "scheduleExceptions"
            FROM teams t
            WHERE t.workspace_id = $1
            ORDER BY t.name;
        `, [workspaceId]);

        return { teams: teamsRes.rows };

    } catch (error: any) {
        console.error("Erro ao buscar equipes:", error);
        return { teams: [], error: `Falha ao buscar dados das equipes no banco de dados. Detalhe: ${error.message}` };
    }
}

export async function createTeam(data: { workspaceId: string, name: string, roleId: string }): Promise<{ team: Team | null; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { team: null, error: "Usuário não autenticado." };
    
    if (!await hasPermission(user.id, data.workspaceId, 'teams:edit')) {
         return { team: null, error: "Você não tem permissão para criar equipes." };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const teamRes = await client.query(
            'INSERT INTO teams (workspace_id, name, role_id, owner_id) VALUES ($1, $2, $3, $4) RETURNING id, name, color, role_id as "roleId", tag_id as "tagId"',
            [data.workspaceId, data.name, data.roleId, user.id]
        );
        const newTeam = teamRes.rows[0];

        // Create default business hours for the new team
        const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const businessHoursValues = days.map(day => `(gen_random_uuid(), '${newTeam.id}', '${day}')`).join(',');
        await client.query(
            `INSERT INTO business_hours (id, team_id, day_of_week) VALUES ${businessHoursValues}`
        );

        await client.query('COMMIT');
        
        // Fetch the newly created business hours to return the full team object
        const businessHoursRes = await client.query(
             `SELECT id, day_of_week as day, is_enabled as "isEnabled", start_time as "startTime", end_time as "endTime"
                FROM business_hours
                WHERE team_id = $1 ORDER BY day_of_week`,
            [newTeam.id]
        );

        const fullTeam: Team = {
            id: newTeam.id,
            name: newTeam.name,
            color: newTeam.color,
            roleId: newTeam.roleId,
            tagId: newTeam.tagId,
            members: [],
            businessHours: businessHoursRes.rows,
            scheduleExceptions: [],
        }

        return { team: fullTeam };
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("Erro ao criar equipe:", error);
        const errorMessage = error.message || 'Ocorreu um erro desconhecido.';
        return { team: null, error: `Falha ao criar a equipe. Detalhe: ${errorMessage}` };
    } finally {
        client.release();
    }
}


export async function updateTeam(teamId: string, data: Partial<Pick<Team, 'name' | 'color' | 'roleId' | 'tagId'>>): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };
    
    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;

    if (!await hasPermission(user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para editar equipes." };
    }

    try {
        const fields = Object.keys(data) as (keyof typeof data)[];
        if (fields.length === 0) {
            return { success: true }; // Nothing to update
        }
        
        // Map JS-style keys to DB-style keys
        const fieldMapping: Record<string, string> = {
            roleId: 'role_id',
            tagId: 'tag_id',
            name: 'name',
            color: 'color'
        };

        const setClauses = fields.map((field, index) => {
            const dbField = fieldMapping[field] || field;
            return `"${dbField}" = $${index + 1}`;
        }).join(', ');

        const values = fields.map(field => {
            const value = data[field];
            return value === 'no-tag' ? null : value;
        });

        const query = `UPDATE teams SET ${setClauses} WHERE id = $${fields.length + 1}`;
        
        await db.query(query, [...values, teamId]);
        
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar equipe:", error);
        return { success: false, error: "Falha ao atualizar a equipe." };
    }
}

export async function deleteTeam(teamId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(user.id, workspaceId, 'teams:edit')) {
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
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(user.id, workspaceId, 'teams:edit')) {
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
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(user.id, workspaceId, 'teams:edit')) {
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

export async function updateBusinessHours(teamId: string, businessHourId: string, data: Partial<Pick<BusinessHour, 'isEnabled' | 'startTime' | 'endTime'>>): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const teamRes = await db.query('SELECT workspace_id FROM teams WHERE id = $1', [teamId]);
    if(teamRes.rowCount === 0) return { success: false, error: "Equipe não encontrada."};
    const workspaceId = teamRes.rows[0].workspace_id;
    
    if (!await hasPermission(user.id, workspaceId, 'teams:edit')) {
         return { success: false, error: "Você não tem permissão para editar horários." };
    }
    
    try {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const setClauses = fields.map((field, index) => {
            const dbField = { isEnabled: 'is_enabled', startTime: 'start_time', endTime: 'end_time' }[field as keyof BusinessHour] || field;
            return `"${dbField}" = $${index + 1}`;
        }).join(', ');
        
        const query = `UPDATE business_hours SET ${setClauses} WHERE id = $${fields.length + 1} AND team_id = $${fields.length + 2}`;
        await db.query(query, [...values, businessHourId, teamId]);

        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar horário:", error);
        return { success: false, error: "Falha ao atualizar o horário de atendimento." };
    }
}

export async function getTeamsWithOnlineMembers(workspaceId: string): Promise<{ teams: (Omit<Team, 'businessHours' | 'scheduleExceptions' | 'members'> & { onlineMembersCount: number })[], error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { teams: [], error: "Usuário não autenticado." };

    // You might want to add a permission check here as well, e.g., 'teams:view'
    if (!await hasPermission(user.id, workspaceId, 'teams:view')) {
        return { teams: [], error: "Acesso não autorizado." };
    }

    try {
        // This query no longer checks the 'online' column
        const res = await db.query(`
            SELECT 
                t.id, 
                t.name, 
                t.color, 
                t.role_id,
                t.tag_id,
                (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as "membersCount"
            FROM teams t
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
            // The online member count will be determined on the client-side using presence.
            // We can return total members for now.
            onlineMembersCount: parseInt(row.membersCount, 10) || 0,
        }));

        return { teams };

    } catch (error) {
        console.error("Erro ao buscar equipes com membros online:", error);
        return { teams: [], error: "Falha ao buscar dados das equipes." };
    }
}

export async function createScheduleException(
  teamId: string,
  data: Omit<ScheduleException, 'id' | 'team_id'>
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };

  try {
    // We should check permissions here too
    await db.query(
      `INSERT INTO schedule_exceptions (team_id, date, description, is_closed, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        teamId,
        data.date,
        data.description,
        data.is_closed,
        data.is_closed ? null : data.start_time,
        data.is_closed ? null : data.end_time,
      ]
    );
    return { success: true };
  } catch (error: any) {
    console.error('[CREATE_SCHEDULE_EXCEPTION] Error:', error);
    return { success: false, error: `Falha ao salvar a exceção: ${error.message}` };
  }
}

export async function deleteScheduleException(exceptionId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };
  
  try {
    // We should check permissions here too
    await db.query('DELETE FROM schedule_exceptions WHERE id = $1', [exceptionId]);
    return { success: true };
  } catch (error: any) {
    console.error('[DELETE_SCHEDULE_EXCEPTION] Error:', error);
    return { success: false, error: `Falha ao remover a exceção: ${error.message}` };
  }
}
