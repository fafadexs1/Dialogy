'use server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {createClient} from '@/lib/supabase/server';
import {hasWorkspacePermission} from '@/lib/workspace-permissions';
import {isSafeGifUrl, type WorkspaceGif} from '@/lib/team-reactions/gifs';
const schema=z.object({workspaceId:z.string().uuid(),name:z.string().trim().min(1).max(60),url:z.string().trim().refine(isSafeGifUrl),sound:z.enum(['none','pum','applause','party','coffee'])});
async function authorized(workspaceId:string,permission:string){const {data:{user}}=await (await createClient()).auth.getUser();return user && await hasWorkspacePermission(user.id,workspaceId,permission)?user:null;}
export async function listWorkspaceGifs(workspaceId:string):Promise<{gifs:WorkspaceGif[];canEdit:boolean;error?:string}>{
 if(!z.string().uuid().safeParse(workspaceId).success)return {gifs:[],canEdit:false,error:'Workspace inválido.'};
 const {data:{user}}=await (await createClient()).auth.getUser();
 if(!user)return {gifs:[],canEdit:false,error:'Entre novamente.'};
 const [canView,canEdit]=await Promise.all([hasWorkspacePermission(user.id,workspaceId,'inbox:access'),hasWorkspacePermission(user.id,workspaceId,'workspace:settings:edit')]);
 if(!canView&&!canEdit)return {gifs:[],canEdit:false,error:'Você não tem acesso a esta biblioteca.'};
 try {const result=await db.query('SELECT id,name,url,sound FROM workspace_team_gifs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[workspaceId]);return {gifs:result.rows,canEdit};}
 catch {return {gifs:[],canEdit,error:'Não foi possível carregar a biblioteca de GIFs.'};}
}
export async function addWorkspaceGif(input:unknown){
 const parsed=schema.safeParse(input);if(!parsed.success)return {success:false,error:'Informe um nome e um link HTTPS direto de GIF.'};
 const {workspaceId,name,url,sound}=parsed.data;const user=await authorized(workspaceId,'workspace:settings:edit');if(!user)return {success:false,error:'Você não tem permissão para editar este workspace.'};
 try {const result=await db.query(`INSERT INTO workspace_team_gifs(workspace_id,name,url,sound,created_by) SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM workspace_team_gifs WHERE workspace_id=$1)<100 RETURNING id`,[workspaceId,name,url,sound,user.id]);return result.rowCount?{success:true}:{success:false,error:'A biblioteca comporta até 100 GIFs.'};}
 catch(error:any){return {success:false,error:error?.code==='23505'?'Este link já está na biblioteca.':'Não foi possível salvar o GIF.'};}
}
export async function removeWorkspaceGif(workspaceId:string,id:string){
 if(!z.string().uuid().safeParse(workspaceId).success||!z.string().uuid().safeParse(id).success)return {success:false,error:'GIF inválido.'};
 const user=await authorized(workspaceId,'workspace:settings:edit');if(!user)return {success:false,error:'Você não tem permissão para editar este workspace.'};
 try {const result=await db.query('DELETE FROM workspace_team_gifs WHERE workspace_id=$1 AND id=$2 RETURNING id',[workspaceId,id]);return result.rowCount?{success:true}:{success:false,error:'GIF não encontrado.'};}catch{return {success:false,error:'Não foi possível remover o GIF.'};}
}

export async function updateWorkspaceGifSound(input:unknown){
 const parsed=z.object({workspaceId:z.string().uuid(),id:z.string().uuid(),sound:z.enum(['none','pum','applause','party','coffee'])}).safeParse(input);
 if(!parsed.success)return {success:false,error:'Selecione um efeito sonoro válido.'};
 const {workspaceId,id,sound}=parsed.data;const user=await authorized(workspaceId,'workspace:settings:edit');
 if(!user)return {success:false,error:'Você não tem permissão para editar este workspace.'};
 try{const result=await db.query('UPDATE workspace_team_gifs SET sound=$3 WHERE workspace_id=$1 AND id=$2 RETURNING id',[workspaceId,id,sound]);return result.rowCount?{success:true}:{success:false,error:'GIF não encontrado.'};}
 catch{return {success:false,error:'Não foi possível alterar o som.'};}
}
