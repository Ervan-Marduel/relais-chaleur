import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/server/auth";
import { logoutAction } from "./actions";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  return (
    <div className="admin">
      {u && (
        <header className="admin-top">
          <div className="wrap">
            <Link href="/admin"><strong>Relais Chaleur · Admin</strong></Link>
            <Link href="/admin/demandes">Demandes</Link>
            <Link href="/admin/materiel">Matériel</Link>
            <Link href="/admin/kpi">Indicateurs</Link>
            <Link href="/admin/notifications">Notifications</Link>
            {u.role === "admin" && <Link href="/admin/parametres">Tarifs &amp; paramètres</Link>}
            {u.role === "admin" && <Link href="/admin/comptes">Comptes</Link>}
            <span className="spacer" />
            <span className="small">{u.name} ({u.role})</span>
            <form action={logoutAction}><button className="btn small ghost" style={{ color: "#fff", borderColor: "#5b6b74" }}>Déconnexion</button></form>
          </div>
        </header>
      )}
      <main className="admin-main" id="contenu">{children}</main>
    </div>
  );
}
