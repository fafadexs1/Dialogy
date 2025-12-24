import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization");
        const secret = process.env.DIALOGY_INTERNAL_SECRET;

        // Security Check
        if (!secret || authHeader !== `Bearer ${secret}`) {
            console.warn("[VerifyAccess] Unauthorized attempt or missing secret");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { email } = body;

        if (!email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }

        // 1. Check if user exists
        const userRes = await db.query(
            "SELECT id, last_active_workspace_id FROM users WHERE email = $1",
            [email]
        );

        if (userRes.rows.length === 0) {
            return NextResponse.json({ active: false, reason: "User not found" });
        }

        const user = userRes.rows[0];

        // 2. Check workspace status (Subscription)
        // We prioritize billing_info, fallback to workspaces table status
        if (user.last_active_workspace_id) {
            // Check billing_info
            const billingRes = await db.query(
                "SELECT status FROM billing_info WHERE workspace_id = $1",
                [user.last_active_workspace_id]
            );

            let status = 'active'; // Default to active if nothing found (legacy/free)

            if (billingRes.rows.length > 0) {
                status = billingRes.rows[0].status;
            } else {
                // Fallback to workspace column
                const wsRes = await db.query(
                    "SELECT subscription_status FROM workspaces WHERE id = $1",
                    [user.last_active_workspace_id]
                );
                if (wsRes.rows.length > 0) {
                    status = wsRes.rows[0].subscription_status || 'active';
                }
            }

            // Normalizing status
            const isActive = ['active', 'trialling', 'trialing'].includes(status.toLowerCase());

            if (!isActive) {
                return NextResponse.json({
                    active: false,
                    reason: `Workspace status is ${status}`
                });
            }
        }

        return NextResponse.json({ active: true });

    } catch (error) {
        console.error("[VerifyAccess] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
