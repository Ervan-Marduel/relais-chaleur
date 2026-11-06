import type { Metadata, Viewport } from "next";
import "./globals.css";
import { publicSiteInfo } from "@/server/site";

export function generateMetadata(): Metadata {
  const s = publicSiteInfo();
  return {
    metadataBase: new URL(s.appUrl),
    title: { default: `${s.brand} — chauffage et climatisation temporaires, livrés et repris`, template: `%s — ${s.brand}` },
    description:
      "Location temporaire de radiateurs à bain d'huile livrés et repris à Lyon et Villeurbanne. Estimation en ligne sans paiement, confirmation par notre équipe.",
    robots: s.mode === "production" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", locale: "fr_FR", siteName: s.brand },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#13222c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
