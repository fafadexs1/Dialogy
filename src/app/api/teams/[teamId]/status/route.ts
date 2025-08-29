
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Helper para verificar se um horário está dentro de um intervalo.
 * Ex: isTimeInRange('14:30', '09:00', '18:00') -> true
 */
function isTimeInRange(timeStr: string, startStr: string | null, endStr: string | null): boolean {
    if (!startStr || !endStr) return false;
    // Compara como strings 'HH:mm'
    return timeStr >= startStr && timeStr < endStr;
}

export async function GET(
    request: Request,
    { params }: { params: { teamId: string } }
) {
    const { teamId } = params;
    
    // --- Autenticação do Agente do Sistema ---
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return NextResponse.json({ error: 'Authorization token is required.' }, { status: 401 });
    }

    const agentRes = await db.query('SELECT workspace_id FROM system_agents WHERE token = $1 AND is_active = TRUE', [token]);
    if (agentRes.rowCount === 0) {
        return NextResponse.json({ error: 'Invalid or inactive agent token.' }, { status: 403 });
    }
    const { workspace_id: workspaceId } = agentRes.rows[0];

    // --- Busca de Dados ---
    try {
        const teamRes = await db.query(
            `SELECT t.id, t.name, w.timezone,
                    COALESCE(json_agg(bh.*) FILTER (WHERE bh.id IS NOT NULL), '[]') as "businessHours",
                    COALESCE(json_agg(se.*) FILTER (WHERE se.id IS NOT NULL), '[]') as "scheduleExceptions"
             FROM teams t
             JOIN workspaces w ON t.workspace_id = w.id
             LEFT JOIN business_hours bh ON t.id = bh.team_id
             LEFT JOIN schedule_exceptions se ON t.id = se.team_id AND se.date = CURRENT_DATE
             WHERE t.id = $1 AND t.workspace_id = $2
             GROUP BY t.id, w.timezone`,
            [teamId, workspaceId]
        );
        
        if (teamRes.rowCount === 0) {
            return NextResponse.json({ error: 'Team not found or not in this workspace.' }, { status: 404 });
        }

        const team = teamRes.rows[0];
        const timezone = team.timezone || 'America/Sao_Paulo';
        const now = toZonedTime(new Date(), timezone);
        
        const currentDate = format(now, 'yyyy-MM-dd');
        const currentTime = format(now, 'HH:mm');
        const currentDayOfWeek = format(now, 'EEEE', { locale: ptBR }); // 'Segunda-feira', 'Terça-feira', etc.
        
        let isOpen = false;
        let reason = 'closed_by_default';
        
        // 1. Verificar exceções para o dia atual
        const todayException = team.scheduleExceptions.find((ex: any) => ex.date.toISOString().split('T')[0] === currentDate);
        
        if (todayException) {
            if (todayException.is_closed) {
                isOpen = false;
                reason = `closed_due_to_exception: ${todayException.description}`;
            } else {
                isOpen = isTimeInRange(currentTime, todayException.start_time, todayException.end_time);
                reason = isOpen ? `open_by_exception: ${todayException.description}` : `closed_by_exception_hours: ${todayException.description}`;
            }
        } else {
        // 2. Se não houver exceção, verificar o horário normal
            const todayBusinessHour = team.businessHours.find((bh: any) => bh.day_of_week === currentDayOfWeek);
            if (todayBusinessHour && todayBusinessHour.is_enabled) {
                isOpen = isTimeInRange(currentTime, todayBusinessHour.start_time, todayBusinessHour.end_time);
                reason = isOpen ? 'open_by_schedule' : 'closed_by_schedule_hours';
            } else {
                reason = 'closed_day_off';
            }
        }
        
        return NextResponse.json({
            teamId: team.id,
            teamName: team.name,
            isOpen,
            reason,
            checkedAt: now.toISOString(),
            currentTime,
            timezone
        });

    } catch (error: any) {
        console.error(`[API TEAMS STATUS] Error for team ${teamId}:`, error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
