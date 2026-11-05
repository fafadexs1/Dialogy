import {db} from '@/lib/db';
/** One short-lived reservation per recipient, shared by all app instances. */
export async function reserveReactionDelivery(userId:string,reactionId:string):Promise<boolean>{
 const result=await db.query(`INSERT INTO team_reaction_delivery_guard(user_id,reaction_id,expires_at)
 VALUES($1,$2,clock_timestamp()+interval '8 seconds')
 ON CONFLICT(user_id) DO UPDATE SET reaction_id=EXCLUDED.reaction_id,expires_at=EXCLUDED.expires_at
 WHERE team_reaction_delivery_guard.expires_at<=clock_timestamp() RETURNING reaction_id`,[userId,reactionId]);
 return result.rows.length>0;
}
export async function releaseReactionDelivery(userId:string,reactionId:string):Promise<void>{
 await db.query('DELETE FROM team_reaction_delivery_guard WHERE user_id=$1 AND reaction_id=$2',[userId,reactionId]);
}

/** Keep the slot while the recipient actually has the GIF open. */
export async function renewReactionDelivery(userId:string,reactionId:string):Promise<boolean>{
 const result=await db.query(`UPDATE team_reaction_delivery_guard SET expires_at=clock_timestamp()+interval '8 seconds'
 WHERE user_id=$1 AND reaction_id=$2 AND expires_at>clock_timestamp() RETURNING reaction_id`,[userId,reactionId]);
 return result.rows.length>0;
}
