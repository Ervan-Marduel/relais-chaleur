import bcrypt from "bcryptjs";
import type { Db } from "@/db/client";
import { eq } from "drizzle-orm";
import { adminSessions, adminUsers, auditEvents } from "@/db/schema";
import type { Role } from "@/lib/domain/status";

/** Gestion des mots de passe admin (bcrypt, coût 12) — sans dépendance à Next pour les scripts CLI. */
export async function hashPassword(pw: string) {
  if (pw.length < 12) throw new Error("Le mot de passe doit contenir au moins 12 caractères.");
  return bcrypt.hash(pw, 12);
}

export async function createAdminUser(db: Db, a: { email: string; name: string; password: string; role?: Role }) {
  const passwordHash = await hashPassword(a.password);
  const [u] = await db.insert(adminUsers).values({ email: a.email.trim().toLowerCase(), name: a.name.trim(), passwordHash, role: a.role ?? "admin" }).returning({ id: adminUsers.id });
  return u;
}

/** Désactive / réactive un compte ; la désactivation révoque immédiatement toutes ses sessions. */
export async function setUserActive(db: Db, actorId: string, userId: string, active: boolean) {
  if (actorId === userId && !active) throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
  await db.transaction(async (tx) => {
    await tx.update(adminUsers).set({ active, failedAttempts: 0, lockedUntil: null }).where(eq(adminUsers.id, userId));
    if (!active) await tx.delete(adminSessions).where(eq(adminSessions.userId, userId));
    await tx.insert(auditEvents).values({ actorId, action: active ? "admin.reactivate" : "admin.deactivate", entity: "admin_user", entityId: userId });
  });
}

/** Réinitialisation par un administrateur (pas d'envoi d'email au MVP) ; révoque les sessions existantes. */
export async function resetUserPassword(db: Db, actorId: string, userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(adminUsers).set({ passwordHash, failedAttempts: 0, lockedUntil: null }).where(eq(adminUsers.id, userId));
    await tx.delete(adminSessions).where(eq(adminSessions.userId, userId));
    await tx.insert(auditEvents).values({ actorId, action: "admin.password_reset", entity: "admin_user", entityId: userId });
  });
}
