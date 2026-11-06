import "server-only";
import { sql, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, notifications } from "@/db/schema";
import { sendEmail } from "./mailer";

export const MAX_ATTEMPTS = 8;
/** Délai avant la tentative n (minutes) : 1, 5, 15, 60, 180, 360, 720. */
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720];

type Row = typeof notifications.$inferSelect;

/**
 * Traite les notifications dues. Sûr en concurrence : la réservation se fait par
 * UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED), donc deux exécutions
 * simultanées (cron + requête) ne prennent jamais la même notification.
 */
export async function processDueNotifications(db: Db, opts: { limit?: number; requestId?: string } = {}) {
  const limit = opts.limit ?? 20;
  const filter = opts.requestId ? sql`AND request_id = ${opts.requestId}` : sql``;
  const claimed = await db.execute<Row & Record<string, unknown>>(sql`
    UPDATE notifications SET status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM notifications
      WHERE ((status IN ('pending','failed') AND next_attempt_at <= now())
          OR (status = 'sending' AND locked_until < now()))
      ${filter}
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, to_email, subject, text_body, html_body, attempts, kind, request_id`);

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const n of claimed as unknown as { id: string; to_email: string; subject: string; text_body: string; html_body: string; attempts: number; kind: string; request_id: string | null }[]) {
    try {
      const r = await sendEmail({ id: n.id, to: n.to_email, subject: n.subject, text: n.text_body, html: n.html_body });
      await db.update(notifications)
        .set({ status: "sent", sentAt: new Date(), providerMessageId: r.providerMessageId, lockedUntil: null, lastError: null })
        .where(eq(notifications.id, n.id));
      results.push({ id: n.id, ok: true });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      const dead = n.attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MIN[Math.min(n.attempts - 1, BACKOFF_MIN.length - 1)];
      await db.update(notifications)
        .set({
          status: dead ? "dead" : "failed",
          lastError: msg,
          lockedUntil: null,
          nextAttemptAt: new Date(Date.now() + delay * 60_000),
        })
        .where(eq(notifications.id, n.id));
      if (dead) {
        await db.insert(auditEvents).values({
          action: "notification.dead", entity: "notification", entityId: n.id,
          metadata: { kind: n.kind, requestId: n.request_id, attempts: n.attempts },
        });
      }
      // Journal technique sans données personnelles
      console.warn(`[notifications] échec ${n.kind} ${n.id} (tentative ${n.attempts}) : ${msg.replace(/\S+@\S+/g, "<email>")}`);
      results.push({ id: n.id, ok: false, error: msg });
    }
  }
  return results;
}

/** Remet une notification « dead » ou « failed » en file pour un envoi immédiat (action admin). */
export async function requeueNotification(db: Db, id: string) {
  await db.update(notifications)
    .set({ status: "pending", nextAttemptAt: new Date(), attempts: 0, lockedUntil: null })
    .where(sql`${notifications.id} = ${id} AND ${notifications.status} IN ('failed','dead')`);
}
