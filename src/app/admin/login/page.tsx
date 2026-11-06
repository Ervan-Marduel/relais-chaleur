import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  if (await currentUser()) redirect("/admin");
  const { ok } = await searchParams;
  return (
    <div className="login-box box">
      <h1>Connexion administration</h1>
      {ok && <div className="notice ok flash"><p>{ok}</p></div>}
      <LoginForm />
      <p className="tiny muted" style={{ marginTop: 14 }}>Accès réservé. Première installation : <Link href="/admin/setup">créer le compte administrateur</Link>.</p>
    </div>
  );
}
