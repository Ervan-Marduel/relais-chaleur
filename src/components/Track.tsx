"use client";
import { useEffect } from "react";

/** Identifiant de session aléatoire (onglet), sans cookie ni donnée personnelle. */
export function sessionId(): string {
  try {
    let id = sessionStorage.getItem("rc_sid");
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      sessionStorage.setItem("rc_sid", id);
    }
    return id;
  } catch {
    return "nostorage00";
  }
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** Mémorise les UTM de la page d'arrivée (pour l'attribution serveur de la demande). */
export function captureAttribution() {
  try {
    if (sessionStorage.getItem("rc_attr")) return;
    const u = new URL(window.location.href);
    const attr: Record<string, string> = { landingPath: u.pathname };
    for (const k of UTM_KEYS) {
      const v = u.searchParams.get(k);
      if (v) attr[k.replace(/_(\w)/, (_, c: string) => c.toUpperCase())] = v.slice(0, 100);
    }
    if (document.referrer) {
      try {
        const h = new URL(document.referrer).host;
        if (h && h !== u.host) attr.referrerHost = h.slice(0, 200);
      } catch { /* ignore */ }
    }
    sessionStorage.setItem("rc_attr", JSON.stringify(attr));
  } catch { /* ignore */ }
}

export function getAttribution(): Record<string, string> | undefined {
  try {
    const raw = sessionStorage.getItem("rc_attr");
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function track(name: "view_service" | "start_estimator" | "estimate_shown" | "start_request", service?: "chauffage" | "climatisation") {
  try {
    const a = getAttribution();
    const body = JSON.stringify({
      name, sessionId: sessionId(), path: window.location.pathname, service,
      utmSource: a?.utmSource, utmMedium: a?.utmMedium, utmCampaign: a?.utmCampaign,
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    else void fetch("/api/events", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch { /* l'analytique ne bloque jamais */ }
}

export default function Track({ event, service }: { event?: "view_service"; service?: "chauffage" | "climatisation" }) {
  useEffect(() => {
    captureAttribution();
    if (event) track(event, service);
  }, [event, service]);
  return null;
}
