import type { MetadataRoute } from "next";
import { publicSiteInfo } from "@/server/site";

export default function robots(): MetadataRoute.Robots {
  const s = publicSiteInfo();
  if (s.mode !== "production") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }], sitemap: `${s.appUrl}/sitemap.xml` };
}
