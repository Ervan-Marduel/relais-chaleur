import type { Metadata } from "next";
import Wizard from "@/components/wizard/Wizard";
import { getPublicSettings } from "@/server/public-settings";
import { publicSiteInfo } from "@/server/site";
import { defaultBusinessSettings } from "@config/business";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Demande de précommande / estimation sans paiement",
  description: "Assistant en quelques étapes : besoin, lieu, quantité indicative, dates, coordonnées. Sans paiement, sous réserve de confirmation.",
  alternates: { canonical: "/demande" },
};

export default async function DemandePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pub = await getPublicSettings();
  const s = pub?.settings ?? defaultBusinessSettings;
  const site = publicSiteInfo();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <Wizard
      initial={{
        service: one("service") === "climatisation" ? "climatisation" : one("service") === "chauffage" ? "chauffage" : undefined,
        surface: one("surface"),
        rooms: one("pieces"),
        insulation: one("isolation"),
        multi: one("multi") === "1",
      }}
      config={{
        termsVersion: s.legal.termsVersion,
        privacyVersion: s.legal.privacyVersion,
        maxSelectableUnits: s.heating.sizing.maxSelectableUnits,
        unitPowerW: s.heating.sizing.unitPowerW,
        voltage: s.heating.sizing.nominalVoltage,
        referenceHeightM: s.heating.sizing.referenceHeightM,
        turnstileSiteKey: site.turnstileSiteKey,
        contactEmail: site.email,
        contactPhone: site.phone,
        settingsAvailable: !!pub,
      }}
    />
  );
}
