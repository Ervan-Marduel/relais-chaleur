import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documents } from "@/db/schema";
import { currentUser } from "@/server/auth";
import { audit } from "@/server/admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Téléchargement d'un bon archivé — réservé aux utilisateurs authentifiés. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response("Non autorisé", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const [doc] = await getDb().select().from(documents).where(eq(documents.id, id));
  if (!doc) return new Response("Introuvable", { status: 404 });
  await audit(getDb(), u.id, "document.download", "document", id);
  return new Response(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number}-v${doc.version}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
