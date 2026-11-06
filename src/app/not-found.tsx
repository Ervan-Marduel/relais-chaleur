import Link from "next/link";
export default function NotFound() {
  return (
    <div className="narrow legal">
      <h1>Page introuvable</h1>
      <p>Cette page n&apos;existe pas ou plus.</p>
      <Link className="btn" href="/">Retour à l&apos;accueil</Link>
    </div>
  );
}
