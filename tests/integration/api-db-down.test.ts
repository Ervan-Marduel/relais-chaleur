import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb } from "@/db/client";
import { POST } from "@/app/api/requests/route";
import { validPayload } from "../support/fixtures";

afterAll(() => closeDb());

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("API /api/requests (gestionnaire réel)", () => {
  it("recette 12 : base injoignable → HTTP 503 explicite, jamais de référence", async () => {
    await closeDb();
    process.env.DATABASE_URL = "postgres://rc@127.0.0.1:1/introuvable";
    process.env.DATABASE_CONNECT_TIMEOUT = "2";
    process.env.MIN_FILL_MS = "0";
    const res = await POST(req({ ...validPayload(), idempotencyKey: randomUUID() }));
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.reference).toBeUndefined();
    expect(j.message).toMatch(/n'a pas pu être enregistrée/);
    await closeDb();
  });

  it("refuse une origine étrangère, un JSON invalide et un honeypot rempli", async () => {
    expect((await POST(req(validPayload(), { origin: "https://evil.example" }))).status).toBe(403);
    const bad = new Request("http://localhost:3000/api/requests", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" }, body: "{oops" });
    expect((await POST(bad)).status).toBe(400);
    expect((await POST(req({ ...validPayload(), idempotencyKey: randomUUID(), website: "spam" }))).status).toBe(400);
    const r422 = await POST(req({ ...validPayload(), customer: { kind: "particulier" } }));
    expect(r422.status).toBe(422);
  });
});
