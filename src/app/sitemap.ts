import type { MetadataRoute } from "next";
import { publicSiteInfo } from "@/server/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicSiteInfo().appUrl;
  return ["", "/chauffage", "/climatisation", "/professionnels", "/demande", "/mentions-legales", "/confidentialite", "/conditions"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: "monthly",
    priority: p === "" ? 1 : p === "/chauffage" ? 0.9 : 0.6,
  }));
}
