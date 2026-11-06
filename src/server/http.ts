import "server-only";
import { NextResponse } from "next/server";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonError(status: number, error: string, message: string, extra?: Record<string, unknown>) {
  return json({ ok: false, error, message, ...extra }, status);
}

export async function readJsonBody(req: Request, maxBytes = 32_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new BodyTooLarge();
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyTooLarge();
  return JSON.parse(text);
}

export class BodyTooLarge extends Error {}
