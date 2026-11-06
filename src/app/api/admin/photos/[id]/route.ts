import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { handoverPhotos } from "@/db/schema";
import { currentUser } from "@/server/auth";
import { audit } from "@/server/admin-data";
import { decryptFile } from "@/server/file-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pièce jointe de constat (photo ou scan du bon signé) — authentification obligatoire, accès journalisé. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response("Non autorisé", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const [p] = await getDb().select().from(handoverPhotos).where(eq(handoverPhotos.id, id));
  if (!p) return new Response("Introuvable", { status: 404 });
  let body: Buffer;
  try {
    body = decryptFile(p.content, p.encryption);
  } catch (e) {
    console.error("[pieces-jointes] déchiffrement impossible :", (e as Error).message);
    return new Response("Pièce jointe illisible (clé de chiffrement absente ou incorrecte).", { status: 500 });
  }
  await audit(getDb(), u.id, "attachment.download", "handover_photo", id, { kind: p.kind });
  const ext = p.contentType === "application/pdf" ? "pdf" : p.contentType.split("/")[1];
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": p.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${p.kind}-${id.slice(0, 8)}.${ext}"`,
    },
  });
}
