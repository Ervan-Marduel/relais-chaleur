import { escapeHtml, formatEuros, formatIsoDate } from "@/lib/format";
import { CLIENT_KIND_LABEL, PLACE_LABEL } from "@/lib/validation/request";

export type EmailContent = { subject: string; text: string; html: string };

type Summary = {
  reference: string;
  service: "chauffage" | "climatisation";
  customer: { kind: keyof typeof CLIENT_KIND_LABEL; companyName?: string | null; contactName: string; phone: string; email: string };
  delivery: { recipientName: string; recipientPhone: string; line1: string; line2?: string | null; postalCode: string; city: string };
  placeType: keyof typeof PLACE_LABEL;
  quantityRequested: number | null;
  quantityRecommended: number | null;
  desiredStartDate: string;
  estimatedDays: number | null;
  quoteMode: "estimate" | "sur_devis";
  totalHtCents: number | null;
  totalTtcCents: number | null;
  expressRequested: boolean;
  requiresManualReview: boolean;
};

function layout(brand: string, title: string, bodyHtml: string) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1d2b33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:10px" cellpadding="0" cellspacing="0">
<tr><td style="padding:20px 24px;border-bottom:3px solid #c2410c;font-weight:bold;font-size:18px">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

function priceText(s: Summary, pro: boolean) {
  if (s.quoteMode === "sur_devis" || s.totalHtCents == null) return "Prix : sur devis (notre équipe vous le communiquera).";
  return pro
    ? `Estimation indicative : ${formatEuros(s.totalHtCents)} HT (${formatEuros(s.totalTtcCents)} TTC), hors électricité, sous réserve de confirmation.`
    : `Estimation indicative : ${formatEuros(s.totalTtcCents)} TTC (${formatEuros(s.totalHtCents)} HT), hors électricité, sous réserve de confirmation.`;
}

export function clientAckEmail(s: Summary, brand: string, contactLine: string): EmailContent {
  const pro = s.customer.kind !== "particulier";
  const service = s.service === "chauffage" ? "chauffage d'appoint" : "climatisation mobile";
  const items = [
    `Service : ${service}`,
    s.quantityRequested ? `Quantité souhaitée : ${s.quantityRequested} appareil(s)` : "Quantité : à déterminer avec vous",
    `Début souhaité : ${formatIsoDate(s.desiredStartDate)}${s.estimatedDays ? ` — durée estimée ${s.estimatedDays} jour(s)` : " — durée à préciser"}`,
    `Lieu : ${s.delivery.line1}, ${s.delivery.postalCode} ${s.delivery.city}`,
    `Réceptionnaire : ${s.delivery.recipientName}`,
    priceText(s, pro),
    ...(s.expressRequested ? ["Option express demandée : à confirmer par l'équipe (supplément uniquement si confirmé)."] : []),
  ];
  const intro = `Votre demande n° ${s.reference} est bien reçue. Notre équipe vous recontactera pour confirmer la disponibilité, le prix et le créneau. Aucun paiement n'a été effectué.`;
  const caution = "Cette demande ne vaut pas confirmation : disponibilité, prix et créneau restent à confirmer par notre équipe. La recommandation de puissance est indicative ; la capacité électrique du site doit être vérifiée par une personne compétente.";
  const text = [
    `Bonjour ${s.customer.contactName},`, "", intro, "",
    "Récapitulatif de votre demande (non contractuel, sous réserve de confirmation) :",
    ...items.map((i) => `- ${i}`), "", caution, "", contactLine,
  ].join("\n");
  const html = layout(
    brand,
    `Demande n° ${s.reference} bien reçue`,
    `<p>Bonjour ${escapeHtml(s.customer.contactName)},</p>
<p><strong>Votre demande n° ${escapeHtml(s.reference)} est bien reçue.</strong> Notre équipe vous recontactera pour confirmer la disponibilité, le prix et le créneau. <strong>Aucun paiement n'a été effectué.</strong></p>
<p style="margin:16px 0 6px;font-weight:bold">Récapitulatif (non contractuel, sous réserve de confirmation)</p>
<ul style="padding-left:18px;margin:0">${items.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
<p style="font-size:13px;color:#4b5b63;margin-top:16px">${escapeHtml(caution)}</p>
<p style="font-size:13px;color:#4b5b63">${escapeHtml(contactLine)}</p>`,
  );
  return { subject: `Demande ${s.reference} reçue — sous réserve de confirmation`, text, html };
}

export function teamAlertEmail(s: Summary, brand: string, adminUrl: string): EmailContent {
  const flags = [
    s.requiresManualReview ? "ÉTUDE / REVUE MANUELLE" : null,
    s.placeType === "erp_ecole" ? "ERP / ÉCOLE" : null,
    s.expressRequested ? "EXPRESS DEMANDÉ" : null,
    s.quoteMode === "sur_devis" ? "SUR DEVIS" : null,
  ].filter(Boolean);
  const lines = [
    `Nouvelle demande ${s.reference} (${s.service})${flags.length ? " — " + flags.join(" · ") : ""}`,
    "",
    `Donneur d'ordre : ${s.customer.companyName ? s.customer.companyName + " — " : ""}${s.customer.contactName} (${CLIENT_KIND_LABEL[s.customer.kind]})`,
    `Tél. : ${s.customer.phone} · Email : ${s.customer.email}`,
    `Réceptionnaire : ${s.delivery.recipientName} · Tél. : ${s.delivery.recipientPhone}`,
    `Lieu : ${s.delivery.line1}${s.delivery.line2 ? ", " + s.delivery.line2 : ""}, ${s.delivery.postalCode} ${s.delivery.city} (${PLACE_LABEL[s.placeType]})`,
    `Quantité : ${s.quantityRequested ?? "—"} souhaitée / ${s.quantityRecommended ?? "—"} recommandée`,
    `Début souhaité : ${formatIsoDate(s.desiredStartDate)} · Durée estimée : ${s.estimatedDays ?? "inconnue"}`,
    s.quoteMode === "estimate" ? `Estimation : ${formatEuros(s.totalHtCents)} HT / ${formatEuros(s.totalTtcCents)} TTC` : "Prix : sur devis",
    "",
    `Ouvrir la fiche : ${adminUrl}`,
  ];
  const html = layout(brand, `Nouvelle demande ${s.reference}`, `<pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px">${escapeHtml(lines.join("\n"))}</pre><p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#c2410c;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ouvrir dans l'administration</a></p>`);
  return { subject: `[${s.reference}] Nouvelle demande ${s.service}${flags.length ? " — " + flags.join(" · ") : ""}`, text: lines.join("\n"), html };
}

export type { Summary as EmailSummary };
