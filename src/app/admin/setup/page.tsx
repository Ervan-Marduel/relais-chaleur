import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { env } from "@/server/env";
import SetupForm from "./SetupForm";

export default async function SetupPage() {
  let count = -1;
  try {
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(adminUsers);
    count = Number(n);
  } catch {
    /* base indisponible */
  }
  const tokenOk = (env().ADMIN_SETUP_TOKEN?.length ?? 0) >= 12;
  return (
    <div className="login-box box">
      <h1>Installation : premier administrateur</h1>
      {count === -1 && <div className="notice danger"><p>Base de données injoignable. Vérifiez DATABASE_URL et les migrations.</p></div>}
      {count > 0 && <div className="notice info"><p>Un administrateur existe déjà : cette page est désactivée. Les comptes supplémentaires se créent avec <code>npm run admin:create</code>.</p></div>}
      {count === 0 && !tokenOk && <div className="notice warn"><p>Définissez d&apos;abord la variable ADMIN_SETUP_TOKEN (12 caractères minimum) dans l&apos;hébergement, puis rechargez.</p></div>}
      {count === 0 && tokenOk && <SetupForm />}
    </div>
  );
}
