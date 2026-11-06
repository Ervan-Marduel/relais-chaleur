import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { formatDateTime } from "@/lib/format";
import { Flash } from "../ui";
import { userActiveAction, userCreateAction, userPasswordAction } from "../actions";

export default async function Comptes({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const me = await requireUser(["admin"]);
  const { ok, err } = await searchParams;
  const users = await getDb().select().from(adminUsers).orderBy(asc(adminUsers.email));
  return (
    <>
      <h1>Comptes d&apos;administration</h1>
      <Flash ok={ok} err={err} />
      <p className="small muted">Comptes nominatifs uniquement. La désactivation et la réinitialisation du mot de passe révoquent immédiatement les sessions ouvertes. Pas de réinitialisation par email au MVP : un administrateur définit un mot de passe provisoire, transmis par un canal séparé.</p>
      <div className="detail-grid">
        <section className="box">
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Email</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td><td>{u.name}</td><td>{u.role}</td>
                <td>{u.active ? "actif" : <span className="badge danger">désactivé</span>}{u.lockedUntil && u.lockedUntil > new Date() ? <> <span className="badge warn">verrouillé</span></> : null}</td>
                <td>{formatDateTime(u.lastLoginAt)}</td>
                <td>
                  {u.id !== me.id && (
                    <form action={userActiveAction} className="inline-form"><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="active" value={u.active ? "false" : "true"} /><button className="btn small ghost">{u.active ? "Désactiver" : "Réactiver"}</button></form>
                  )}
                  <details><summary className="small">Nouveau mot de passe</summary>
                    <form action={userPasswordAction} className="inline-form"><input type="hidden" name="userId" value={u.id} /><input type="password" name="password" minLength={12} required aria-label={`Nouveau mot de passe pour ${u.email}`} /><button className="btn small ghost">Définir</button></form>
                  </details>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="box">
          <h2>Ajouter un compte</h2>
          <form action={userCreateAction}>
            <label className="field"><span className="label small">Email</span><input type="email" name="email" required /></label>
            <label className="field"><span className="label small">Nom</span><input type="text" name="name" required /></label>
            <label className="field"><span className="label small">Rôle</span><select name="role"><option value="commercial">commercial</option><option value="preparateur">préparateur</option><option value="exploitant">exploitant</option><option value="admin">admin</option></select></label>
            <label className="field"><span className="label small">Mot de passe provisoire (12 caractères min.)</span><input type="password" name="password" minLength={12} required /></label>
            <button className="btn small">Créer</button>
          </form>
        </section>
      </div>
    </>
  );
}
