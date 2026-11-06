/** Cycle de vie d'une demande. Seul un administrateur peut passer à « confirmee ». */
export const REQUEST_STATUSES = [
  "nouvelle_demande",
  "a_qualifier",
  "devis_a_confirmer",
  "confirmee",
  "preparation",
  "livree",
  "reprise_planifiee",
  "reprise_effective",
  "cloturee",
  "refusee",
  "annulee",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  nouvelle_demande: "Nouvelle demande",
  a_qualifier: "À qualifier",
  devis_a_confirmer: "Devis à confirmer",
  confirmee: "Confirmée",
  preparation: "En préparation",
  livree: "Livrée",
  reprise_planifiee: "Reprise planifiée",
  reprise_effective: "Reprise effectuée",
  cloturee: "Clôturée",
  refusee: "Refusée",
  annulee: "Annulée",
};

export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  nouvelle_demande: ["a_qualifier", "devis_a_confirmer", "refusee", "annulee"],
  a_qualifier: ["devis_a_confirmer", "refusee", "annulee"],
  devis_a_confirmer: ["confirmee", "a_qualifier", "refusee", "annulee"],
  confirmee: ["preparation", "devis_a_confirmer", "annulee"],
  preparation: ["livree", "confirmee", "annulee"],
  livree: ["reprise_planifiee", "reprise_effective"],
  reprise_planifiee: ["reprise_effective", "livree"],
  reprise_effective: ["cloturee"],
  cloturee: [],
  refusee: ["a_qualifier"],
  annulee: [],
};

export type Role = "admin" | "commercial" | "preparateur" | "exploitant";

/** Contrôles humains obligatoires avant « confirmee ». */
export const CONFIRMATION_CHECKS = [
  { key: "stock", label: "Stock physiquement vérifié et disponible sur la période" },
  { key: "zone", label: "Zone de livraison et accès vérifiés" },
  { key: "electricite", label: "Capacité électrique discutée avec le client (vérification par une personne compétente rappelée)" },
  { key: "devis", label: "Devis / prix communiqué et accepté par le donneur d'ordre (hors site)" },
  { key: "creneau", label: "Créneau de livraison convenu avec le réceptionnaire" },
] as const;
export const ERP_CHECK = {
  key: "erp",
  label: "ERP / école : validation préalable du responsable du site obtenue (admissibilité et implantation)",
} as const;

export type TransitionError =
  | "transition_interdite"
  | "role_insuffisant"
  | "controles_incomplets"
  | "devis_requis"
  | "creneau_requis";

export function checkTransition(args: {
  from: RequestStatus;
  to: RequestStatus;
  role: Role;
  checks?: Record<string, boolean>;
  isErp: boolean;
  hasQuote: boolean;
  hasDeliverySlot: boolean;
}): TransitionError | null {
  if (!TRANSITIONS[args.from].includes(args.to)) return "transition_interdite";
  if (args.to === "confirmee") {
    if (args.role !== "admin") return "role_insuffisant";
    const required: string[] = CONFIRMATION_CHECKS.map((c) => c.key);
    if (args.isErp) required.push(ERP_CHECK.key);
    if (!required.every((k) => args.checks?.[k] === true)) return "controles_incomplets";
    if (!args.hasQuote) return "devis_requis";
    if (!args.hasDeliverySlot) return "creneau_requis";
  }
  if ((args.to === "refusee" || args.to === "annulee") && args.role !== "admin" && args.role !== "commercial")
    return "role_insuffisant";
  return null;
}

export const TRANSITION_ERROR_TEXT: Record<TransitionError, string> = {
  transition_interdite: "Ce changement de statut n'est pas autorisé depuis le statut actuel.",
  role_insuffisant: "Votre rôle ne permet pas ce changement de statut.",
  controles_incomplets: "Tous les contrôles humains doivent être cochés avant confirmation.",
  devis_requis: "Un devis (version figée) doit exister avant confirmation.",
  creneau_requis: "Un créneau de livraison confirmé doit être renseigné avant confirmation.",
};
