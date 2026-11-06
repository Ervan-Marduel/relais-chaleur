export function validPayload() {
  return {
    idempotencyKey: "6f1c1f1e-8a51-4d3f-9a4c-0d0f2f0e9b11",
    service: "chauffage",
    heating: { surfaceMode: "total", totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 2.5, insulation: "bonne", quantityRequested: 1 },
    site: { placeType: "appartement", elevator: "oui", multiSite: false },
    schedule: { desiredStartDate: "2026-11-20", durationUnknown: false, estimatedDays: 7, expressRequested: false },
    customer: { kind: "entreprise", companyName: "Syndic Test", siret: "73282932000074", contactName: "Alice Martin", phone: "06 12 34 56 78", email: "alice@example.com" },
    delivery: { recipientName: "Bruno Leroy", recipientPhone: "07 11 22 33 44", address: { line1: "12 rue Test", postalCode: "69003", city: "Lyon" } },
    consent: { terms: true, privacy: true, termsVersion: "x", privacyVersion: "y" },
  } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
