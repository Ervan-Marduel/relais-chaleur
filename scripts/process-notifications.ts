/** Traite manuellement la file d'emails (secours si la tâche planifiée est indisponible). */
import { closeDb, getDb } from "../src/db/client";
import { processDueNotifications } from "../src/server/notifications";

const r = await processDueNotifications(getDb(), { limit: 100 });
console.log(`${r.length} traitée(s) : ${r.filter((x) => x.ok).length} envoyée(s), ${r.filter((x) => !x.ok).length} en échec.`);
await closeDb();
