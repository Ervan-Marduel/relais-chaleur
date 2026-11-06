import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

export type OutgoingEmail = { id: string; to: string; subject: string; text: string; html: string };
export type SendResult = { providerMessageId: string };

/**
 * Transport d'email côté serveur uniquement.
 * - resend   : production (API HTTPS, clé d'idempotence = id de notification ⇒ pas de double envoi en cas de retry)
 * - file     : développement/tests (écrit dans MAIL_OUTBOX_DIR, aucun envoi réel)
 * - fail     : tests de robustesse (échoue toujours)
 * - disabled : aucun envoi (la notification reste en attente, visible dans l'admin)
 */
export async function sendEmail(mail: OutgoingEmail): Promise<SendResult> {
  const e = env();
  const driver = process.env.EMAIL_DRIVER ?? e.EMAIL_DRIVER;
  if (driver === "fail") throw new Error("Échec simulé du transport email (EMAIL_DRIVER=fail)");
  if (driver === "disabled") throw new Error("Transport email désactivé (EMAIL_DRIVER=disabled)");
  if (driver === "file") {
    const dir = process.env.MAIL_OUTBOX_DIR ?? path.join(process.cwd(), ".mail-outbox");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${mail.id}.json`), JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 2));
    return { providerMessageId: `file:${mail.id}` };
  }
  if (!e.RESEND_API_KEY || !e.EMAIL_FROM) throw new Error("Resend non configuré (RESEND_API_KEY / EMAIL_FROM)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": mail.id,
    },
    body: JSON.stringify({
      from: e.EMAIL_FROM,
      to: [mail.to],
      reply_to: e.EMAIL_REPLY_TO || undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as { id?: string };
  return { providerMessageId: j.id ?? "resend:unknown" };
}
