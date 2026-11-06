"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/chauffage", label: "Chauffage" },
  { href: "/climatisation", label: "Climatisation" },
  { href: "/professionnels", label: "Professionnels" },
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="nav-link" aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}
