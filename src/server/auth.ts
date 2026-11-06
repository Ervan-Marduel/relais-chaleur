import "server-only";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, type Db } from "@/db/client";
import { adminSessions, adminUsers, auditEvents } from "@/db/schema";
import type { Role } from "@/lib/domain/status";
import { env } from "./env";
import { randomToken, rateLimit, sha256 } from "./security";
export { hashPassword, createAdminUser } from "./passwords";

const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function sessionCookieName() {
  return env().APP_URL.startsWith("https://") ? "__Host-rc_admin" : "rc_admin";
}

const DUMMY_HASH = "$2b$12$nUHsETu9mzaNsuQqjm/lb.FIBO190BAHYm993ZmQcxXq2dYt/vLue";

export type LoginResult = { ok: true; token: string; userId: string } | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

export async function login(db: Db, email: string, password: string, ipHash: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  if (!(await rateLimit(db, `login-ip:${ipHash}`, 20, 900))) return { ok: false, reason: "rate_limited" };
  if (!(await rateLimit(db, `login-email:${sha256(normalized)}`, 10, 900))) return { ok: false, reason: "rate_limited" };

  const [user] = await db.select().from(adminUsers).where(sql`lower(${adminUsers.email}) = ${normalized}`).limit(1);
  if (!user || !user.active) {
    await bcrypt.compare(password, DUMMY_HASH); // temps constant : pas d'énumération de comptes
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, reason: "locked" };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedAttempts + 1;
    await db.update(adminUsers).set({
      failedAttempts: failed >= MAX_FAILED ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    }).where(eq(adminUsers.id, user.id));
    await db.insert(auditEvents).values({ actorId: user.id, action: "auth.login_failed", metadata: { locked: failed >= MAX_FAILED } });
    return { ok: false, reason: failed >= MAX_FAILED ? "locked" : "invalid" };
  }

  const token = randomToken(32);
  await db.insert(adminSessions).values({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) });
  await db.update(adminUsers).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  await db.insert(auditEvents).values({ actorId: user.id, action: "auth.login" });
  return { ok: true, token, userId: user.id };
}

export type SessionUser = { id: string; email: string; name: string; role: Role; sessionId: string };

export async function sessionFromToken(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await db
    .select({ sid: adminSessions.id, id: adminUsers.id, email: adminUsers.email, name: adminUsers.name, role: adminUsers.role, active: adminUsers.active })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || !r.active) return null;
  return { id: r.id, email: r.email, name: r.name, role: r.role, sessionId: r.sid };
}

/** Session courante (Server Components / Actions / Route Handlers). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  try {
    return await sessionFromToken(getDb(), token);
  } catch {
    return null;
  }
});

/** À appeler en tête de CHAQUE page, action et route d'administration. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/admin/login");
  if (roles && !roles.includes(u.role)) redirect("/admin?erreur=droits");
  return u;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) {
    try {
      await getDb().delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(token)));
    } catch {
      /* ignore */
    }
  }
  jar.delete(sessionCookieName());
}

