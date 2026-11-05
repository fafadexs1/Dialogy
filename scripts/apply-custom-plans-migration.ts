import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";

const name = "20260912220000_custom_workspace_plans";
const sql = readFileSync(
  resolve("prisma/migrations", name, "migration.sql"),
  "utf8",
);
const checksum = createHash("sha256").update(sql).digest("hex");
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('dialogy-custom-plans-migration'))",
    );
    const existing = (
      await client.query(
        "SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL",
        [name],
      )
    ).rows[0];
    if (existing) {
      if (existing.checksum !== checksum || !existing.finished_at)
        throw new Error("Migration history differs; inspect before applying.");
      console.log("Migration already applied; checksum verified.");
    } else if (process.argv.includes("--apply")) {
      await client.query(sql);
      await client.query(
        "INSERT INTO _prisma_migrations(id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),now(),1)",
        [randomUUID(), checksum, name],
      );
      console.log("Custom workspace plans migration applied.");
    } else {
      console.log(
        "Pending migration:",
        name,
        "Use --apply to apply only this migration.",
      );
    }
    await client.query("COMMIT");
    if (existing || process.argv.includes("--apply")) {
      console.log(
        JSON.stringify(
          (
            await client.query(
              `SELECT scope,count(*)::int AS plans FROM plans GROUP BY scope ORDER BY scope`,
            )
          ).rows,
        ),
      );
      console.log(
        "Assignment table:",
        (
          await client.query(
            "SELECT to_regclass('public.plan_workspaces') IS NOT NULL AS present",
          )
        ).rows[0].present,
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
