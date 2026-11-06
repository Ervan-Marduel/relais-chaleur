import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "@/db/client";
import { ensureDefaultSettings } from "@/server/settings-store";
import { createPreorder } from "@/server/preorders";
import { requestPayloadSchema } from "@/lib/validation/request";
import { TEST_DB_URL } from "../support/db";
import { validPayload } from "../support/fixtures";

afterAll(() => closeDb());

describe("migration 0004 sur des données existantes (reprise explicite et tracée)", () => {
  it("convertit l'ancien mécanisme de libération sans perte ni modification silencieuse", async () => {
    await closeDb();
    const sql = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    // 1) schéma jusqu'à 0003 seulement
    const dir = mkdtempSync(path.join(tmpdir(), "rc-mig-"));
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const keep = journal.entries.filter((e: { idx: number }) => e.idx <= 3);
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: keep }));
    for (const e of keep) cpSync(`drizzle/${e.tag}.sql`, path.join(dir, `${e.tag}.sql`));
    await migrate(drizzle(sql), { migrationsFolder: dir });

    // 2) données « anciennes » : une demande livrée avec 2 appareils, dont un « libéré » manuellement
    process.env.DATABASE_URL = TEST_DB_URL;
    const db = getDb();
    await ensureDefaultSettings(db);
    const r = await createPreorder(db, requestPayloadSchema.parse({ ...validPayload(), idempotencyKey: randomUUID() }));
    const [u] = await sql`INSERT INTO admin_users (email, name, password_hash) VALUES ('m@test.invalid','M','x') RETURNING id`;
    const [m] = await sql`INSERT INTO equipment_models (service, brand, model) VALUES ('chauffage','B','M') RETURNING id`;
    const [u1] = await sql`INSERT INTO equipment_units (inventory_code, model_id) VALUES ('RC-901', ${m.id}) RETURNING id`;
    const [u2] = await sql`INSERT INTO equipment_units (inventory_code, model_id) VALUES ('RC-902', ${m.id}) RETURNING id`;
    await sql`UPDATE requests SET status = 'livree', delivered_at = '2026-11-01T08:00:00Z' WHERE id = ${r.id}`;
    await sql`INSERT INTO allocations (request_id, unit_id, start_at, end_at, created_by) VALUES (${r.id}, ${u1.id}, '2026-11-01T08:00:00Z', '2026-11-05T08:00:00Z', ${u.id})`;
    await sql`INSERT INTO allocations (request_id, unit_id, start_at, end_at, released_at, created_by) VALUES (${r.id}, ${u2.id}, '2026-11-01T08:00:00Z', '2026-11-05T08:00:00Z', '2026-11-02T10:00:00Z', ${u.id})`;
    await closeDb();

    // 3) migrations complètes (0004)
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    const rows = await sql`SELECT u.inventory_code, a.status, a.delivered_at, a.cancel_reason, a.released_at FROM allocations a JOIN equipment_units u ON u.id = a.unit_id ORDER BY 1`;
    expect(rows[0].status).toBe("remise"); // RC-901 : toujours chez le client
    expect(new Date(rows[0].delivered_at).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(rows[1].status).toBe("annulee"); // RC-902 : ancienne libération, motif explicite
    expect(rows[1].cancel_reason).toMatch(/Migration 0004/);
    expect(rows[1].released_at).not.toBeNull(); // la donnée d'origine est conservée
    const ev = await sql`SELECT kind, details FROM allocation_events WHERE request_id = ${r.id}`;
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.kind === "migration")).toBe(true);
    // la nouvelle règle s'applique : RC-901 ne peut pas être réservé ailleurs
    await expect(sql`INSERT INTO allocations (request_id, unit_id, start_at, created_by) VALUES (${r.id}, ${u1.id}, now(), ${u.id})`).rejects.toThrow();
    await sql.end();
  });
});
