import "server-only";
import { getDb } from "@/db/client";
import type { BusinessSettings } from "@/lib/domain/settings";
import { getActiveSettingsCached } from "./settings-store";

/** Grille active pour l'affichage public ; null si la base est indisponible (on n'affiche alors aucun prix). */
export async function getPublicSettings(): Promise<{ version: number; settings: BusinessSettings } | null> {
  try {
    const a = await getActiveSettingsCached(getDb());
    return { version: a.version, settings: a.settings };
  } catch {
    return null;
  }
}
