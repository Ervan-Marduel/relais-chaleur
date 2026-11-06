# RELAIS CHALEUR LYON — APPLICATION COMPLÈTE V3.1

**Ceci est le vrai projet de l’application**, avec deux parcours (chauffage et climatisation), Next.js, PostgreSQL, espace administrateur, demandes, stock et bons PDF.

⚠️ **La démonstration actuellement en ligne sur GitHub Pages est statique et différente de cette application.** GitHub Pages ne peut pas exécuter le serveur Next.js ni PostgreSQL.

**Pour visualiser l’application réelle** : déployer dans un environnement Next.js avec base PostgreSQL de préproduction et variables de test, puis suivre `docs/MISE_EN_LIGNE.md` et `docs/RECETTE_PARCOURS.md`. Ne pas ouvrir commercialement avant recette réelle et validations juridiques.

**Pour publier le dépôt** : garder `.env.local`, les mots de passe et les données clients hors GitHub. Le fichier `.env.example` est un modèle sans clés réelles.

---

# Relais Chaleur Lyon — précommandes de chauffage / climatisation temporaires

Application **autonome** (nouveau dépôt, aucune ressource partagée avec d'autres sociétés) :

- **site public** : accueil, `/chauffage`, `/climatisation`, `/professionnels`, pages légales (modèles) ;
- **assistant de précommande** `/demande` (7 étapes, mobile-first, brouillon local, estimation *avant* identité) ;
- **API serveur** : validation Zod, prix recalculés et figés côté serveur, idempotence, anti-spam, limitation de débit ;
- **PostgreSQL** (migrations versionnées, contraintes d'immuabilité et d'anti-chevauchement) ;
- **emails transactionnels** (Resend) via une file d'envoi avec retries — une panne email ne perd jamais une demande ;
- **back-office privé** `/admin` : tableau de bord, fiches, statuts tracés, devis versionnés, planning, parc matériel, affectation contrôlée,
  **constats de remise et de reprise** (dates réelles, notice par modèle, signature, incidents, scan chiffré du bon signé, reprise partielle),
  **contrôle technique obligatoire avant toute relocation**, disponibilité physique du parc, KPI, export CSV, comptes, paramètres versionnés ;
- **bon unique de remise et de reprise** en PDF A4 (1 page + annexe d'inventaire au-delà de 12 appareils), archivé.

> Ce dépôt est **prêt pour une pré-production**. Il n'est **pas** « prêt pour la production commerciale » tant que
> l'identité légale, les textes validés, le domaine, Resend et la base de production ne sont pas configurés
> (voir [`docs/CHECKLIST_OUVERTURE.md`](docs/CHECKLIST_OUVERTURE.md)). L'application l'impose : sans ces éléments,
> elle reste en mode pré-production (non indexée, bandeau visible) même si `SITE_MODE=production`.

## Documentation

| Document | Pour qui |
|---|---|
| [`docs/MISE_EN_LIGNE.md`](docs/MISE_EN_LIGNE.md) | **Guide « Je le mets en ligne »** pas à pas (non-développeur) |
| [`docs/CHECKLIST_OUVERTURE.md`](docs/CHECKLIST_OUVERTURE.md) | Checklist d'ouverture commerciale + éléments bloquants à fournir |
| [`docs/CONFIGURATION_METIER.md`](docs/CONFIGURATION_METIER.md) | Modifier tarifs, puissance, zones, délais, véhicules |
| [`docs/ARCHITECTURE_ET_DROITS.md`](docs/ARCHITECTURE_ET_DROITS.md) | Schéma de base, droits, sécurité, RGPD |
| [`docs/JOURNAL_DE_TESTS.md`](docs/JOURNAL_DE_TESTS.md) | Résultats réels des tests, corrections de l'audit, éléments non faits |
| [`docs/RECETTE_PARCOURS.md`](docs/RECETTE_PARCOURS.md) | Parcours de recette complet : précommande → remise réelle → reprise partielle/complète → parc disponible |
| [`docs/AUDIT_SOURCES.md`](docs/AUDIT_SOURCES.md) | Contradictions relevées dans les 5 fichiers d'origine et décisions |
| [`docs/captures/`](docs/captures/) | Captures desktop / mobile et exemple de bon PDF |

## Démarrage local (développeur)

Prérequis : Node.js ≥ 20.9 (testé en 22), PostgreSQL 16 installé localement (binaires `initdb`/`pg_ctl`), `poppler-utils` pour les tests PDF.

```bash
npm ci
cp .env.example .env.local          # puis compléter (voir commentaires)
npm run db:local                    # PostgreSQL jetable sur 127.0.0.1:54329 (dossier .local-pg/)
# dans .env.local : DATABASE_URL=postgres://rc@127.0.0.1:54329/rc_dev
npm run db:migrate
npm run db:seed -- --demo           # paramètres v1 + données de DÉMONSTRATION (jamais en production)
npm run dev                         # http://localhost:3000 — admin démo : admin@demo.invalid / demo-admin-1234
```

En local, `EMAIL_DRIVER=file` écrit les emails dans `.mail-outbox/` au lieu de les envoyer.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint (config Next) / TypeScript strict |
| `npm test` | Tests unitaires + intégration (Vitest, base `rc_test` recréée à chaque fichier) |
| `npm run test:e2e` | Playwright : prépare `rc_e2e`, **build de production**, lance le serveur, desktop + mobile 390/375 px |
| `npm run build` / `npm start` | Build / serveur de production |
| `npm run db:generate` | Génère une migration depuis `src/db/schema.ts` |
| `npm run db:status` | État des migrations et des garde-fous (0004-0006) — code de sortie 2 si non conforme |
| `npm run db:migrate` | Applique les migrations (`MIGRATION_DATABASE_URL` ou `DATABASE_URL`), sous verrou PostgreSQL — procédure : `docs/MISE_EN_LIGNE.md` étape 5 bis |
| `npm run db:seed [-- --demo]` | Paramètres initiaux (+ démo) |
| `npm run admin:create -- --email … --name …` | Crée un compte admin (mot de passe demandé) |
| `npm run check:launch` | Vérifie la checklist d'ouverture (code 1 si incomplet) |
| `npm run notifications:process` | Vide la file d'emails manuellement |

## Arborescence

```
config/business.ts          paramètres métier par défaut (v1 de la grille) — voir CONFIGURATION_METIER.md
drizzle/                    migrations SQL versionnées (0000 schéma, 0001 immuabilité, 0002 RLS, 0003-0004 disponibilité physique + constats, 0005-0006 contrôles techniques, incidents, preuves)
src/lib/domain/             règles pures et testées : chauffage, climatisation, tarifs, statuts
src/lib/validation/         schémas Zod partagés navigateur / serveur
src/db/                     schéma Drizzle + client PostgreSQL
src/server/                 précommandes, notifications, emails, auth, bon PDF, opérations admin (server-only)
src/pdf/BonDocument.tsx     gabarit du bon de remise et de reprise
src/app/(site)/             pages publiques + assistant
src/app/admin/              back-office (toutes les pages et actions vérifient la session côté serveur)
src/app/api/                requests, estimate, events, cron, admin (export CSV, documents)
tests/unit|integration|e2e  tests automatisés
scripts/                    migrations, seed, admin, checklist, Postgres local, build Vercel
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · CSS maison (aucune police ni script tiers) · Zod 4 ·
Drizzle ORM + `postgres` · bcrypt · `@react-pdf/renderer` · Resend (API HTTPS) · Vitest · Playwright · GitHub Actions · Vercel.
Supabase est utilisé **uniquement comme hébergeur PostgreSQL** (aucune clé Supabase dans l'application).
