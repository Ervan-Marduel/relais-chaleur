/**
 * Crée un compte d'administration (saisie interactive du mot de passe, jamais en argument).
 *   DATABASE_URL=... npm run admin:create -- --email vous@domaine.fr --name "Prénom Nom" [--role admin|commercial|preparateur|exploitant]
 */
import { createInterface } from "node:readline";
import { closeDb, getDb } from "../src/db/client";
import { createAdminUser } from "../src/server/passwords";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const email = arg("email");
const name = arg("name") ?? email;
const role = (arg("role") ?? "admin") as "admin";
if (!email) { console.error("Usage : npm run admin:create -- --email x@y.fr --name \"Nom\""); process.exit(1); }

const ask = (q: string) => new Promise<string>((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes(q)) process.stdout.write(s); };
  rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); res(a); });
});

const pw = process.env.ADMIN_PASSWORD ?? (await ask("Mot de passe (12 caractères min.) : "));
try {
  const u = await createAdminUser(getDb(), { email, name: name!, password: pw, role });
  console.log(`Compte créé : ${email} (${role}) — id ${u.id}`);
} catch (e) {
  console.error("Échec :", (e as Error).message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
