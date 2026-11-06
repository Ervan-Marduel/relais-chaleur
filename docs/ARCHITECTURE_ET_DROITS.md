# Architecture, schéma de base et droits

## Flux principal
```
Visiteur ── /demande (assistant, brouillon localStorage, rien n'est envoyé avant validation)
   │  POST /api/estimate  (prix calculé serveur, aucune écriture)
   │  POST /api/requests  (Origin, taille ≤ 32 Ko, Zod, honeypot, délai, Turnstile, rate limit, idempotence)
   ▼
Transaction PostgreSQL : customers + delivery_sites + requests (+ snapshot prix figé) + status_events + notifications (outbox)
   │ COMMIT  → réponse 201 avec la référence RC-AAAA-NNNNNN   (avant : jamais de « succès »)
   ▼
after() / cron / tableau de bord → processDueNotifications → Resend (Idempotency-Key = id notification)
   échec → retry 1, 5, 15, 60 min… → « dead » après 8 tentatives, alerte dans /admin (la demande reste en base)
   ▼
/admin : qualification → devis (version figée) → planning (quantité + modèle confirmés) → confirmation (admin + contrôles)
        → affectation contrôlée (état, modèle, quantité ; appareil bloqué jusqu'à sa reprise constatée)
        → bon PDF (archivé, immuable) → CONSTAT DE REMISE (date/heure réelles) → livrée
        → CONSTAT(S) DE REPRISE (partielle ou totale, état par appareil) → reprise effectuée → clôture
```

## Tables
| Table | Contenu | Règles notables |
|---|---|---|
| `customers` | Donneur d'ordre : type, raison sociale, SIRET, contact, adresse de facturation | `CHECK` : SIRET interdit pour un particulier |
| `delivery_sites` | Lieu + **réceptionnaire** (nom, téléphone), accès, étage, ascenseur, type de lieu | Toujours distinct du donneur d'ordre |
| `requests` | Besoin, quantités **recommandée et souhaitée**, dates souhaitées, consentements versionnés, attribution UTM, planning, coûts réels (phase 2) | Référence et clé d'idempotence uniques ; **déclencheur d'immuabilité** sur prix, consentements, référence |
| `pricing_versions` | Paramètres métier versionnés (JSON validé Zod) | Une seule version active (index partiel) ; contenu immuable |
| `quotes` | Devis versionnés (lignes, HT, TVA, TTC) | Immuables (déclencheur) |
| `equipment_models` | Catalogue multitype chauffage/clim : marque, modèle, réf., W électriques / W froid / BTU, notice, restrictions | Référence « vérifiée » explicite |
| `equipment_units` | Parc : code interne RC-001…, n° de série constructeur (facultatif, unique par modèle), lot, état | Code interne unique ; le lot n'identifie jamais un appareil |
| `allocations` | Affectation appareil ↔ demande : statut `reservee` → `remise` → `retournee` (ou `annulee` avant remise) ; dates prévues (`start_at`, `end_at`) et **réelles** (`delivered_at`, `returned_at`, `return_verified_at`, `return_condition`) | **Index unique partiel** : une seule affectation ouverte par appareil, sans limite de date ; **exclusion GiST** sur les périodes physiques ; contrôles de cohérence ; déclencheurs : pas de suppression, pas de modification après clôture, pas de libération d'un appareil remis |
| `allocation_events` | Journal de vie de chaque affectation (réservation, remise, reprise, annulation, prolongation, migration) | Immuable (ni modification ni suppression) |
| `handovers` / `handover_items` / `handover_photos` | Constats de remise et de reprise : faits réels, appareils, état, **notice par modèle**, **signature (signé / refus / non recueillie)**, **issue (conforme / avec réserves / incident)**, réserves ; pièces jointes : photos et **scan du bon signé** (AES-256-GCM si `FILE_ENCRYPTION_KEY`) | Immuables, pièces jointes non supprimables ; « conforme » impossible en base sans signature ET notice |
| `incidents` | Notice non remise, refus ou absence de signature : motif, consignes, résolution | Ouverture automatique par le constat ; seule la résolution est modifiable (admin, motif obligatoire) ; pas de suppression |
| `unit_inspections` | Contrôle technique : date, contrôleur, 5 points, anomalies, décision neuf / bon / hors service | Immuable. **Déclencheur** : un appareil ne passe à neuf/bon qu'avec une inspection enregistrée dans la même transaction ; tout nouvel appareil entre « à contrôler » |
| `documents` | Bons PDF (contenu, SHA-256, snapshot des données) | Immuables ; numéro BR stable, versions incrémentées |
| `status_events` | Historique : de → vers, acteur, date, note | Immuable |
| `activities` | Appels, notes internes, emails | Auteur obligatoire |
| `notifications` | File d'envoi (outbox) : statut, tentatives, prochaine tentative, erreur | Clé de déduplication unique par demande et type |
| `audit_events` | Connexions, exports, téléchargements, changements de paramètres, échecs définitifs d'email | — |
| `admin_users` / `admin_sessions` | Comptes (bcrypt coût 12, verrouillage 15 min après 5 échecs) / sessions (jeton aléatoire 256 bits, **haché** en base, 12 h) | Email unique insensible à la casse |
| `counters` | Compteurs atomiques des références (RC, BR) par année | `INSERT … ON CONFLICT … RETURNING` dans la transaction |
| `rate_limits` | Fenêtres de limitation (clé = hash IP salé) | Aucune IP en clair |
| `analytics_events` | Entonnoir sans cookie ni IP (session aléatoire d'onglet) | `request_submitted` écrit **uniquement** par le serveur après COMMIT |

Toutes les tables ont **RLS activé sans politique** (migrations 0002 et 0004) : l'API Supabase n'y donne aucun accès ;
l'application se connecte avec le rôle propriétaire.

## Droits
| Action | admin | commercial | préparateur | exploitant | public |
|---|:-:|:-:|:-:|:-:|:-:|
| Envoyer une demande | | | | | ✔ |
| Lire demandes, fiches, KPI | ✔ | ✔ | ✔ | ✔ | ✘ |
| Notes, appels, statuts courants | ✔ | ✔ | ✔ | ✔ | ✘ |
| Refuser / annuler | ✔ | ✔ | ✘ | ✘ | ✘ |
| **Confirmer** (après contrôles + devis + créneau) | ✔ | ✘ | ✘ | ✘ | ✘ |
| Créer un devis | ✔ | ✔ | ✘ | ✘ | ✘ |
| Affecter du matériel, générer le bon, saisir les constats | ✔ | ✘ | ✔ | ✔ | ✘ |
| Annuler une réservation (appareil non remis) | ✔ | ✘ | ✘ | ✘ | ✘ |
| Contrôle technique (rendre un appareil louable) | ✔ | ✘ | ✔ | ✔ | ✘ |
| Déposer le scan du bon signé | ✔ | ✘ | ✔ | ✔ | ✘ |
| Clôturer un incident | ✔ | ✘ | ✘ | ✘ | ✘ |
| Gérer les comptes (créer, désactiver, réinitialiser) | ✔ | ✘ | ✘ | ✘ | ✘ |
| Catalogue et parc | ✔ | ✘ | état seulement | ✔ | ✘ |
| Export CSV | ✔ | ✔ | ✘ | ✘ | ✘ |
| Tarifs et paramètres | ✔ | ✘ | ✘ | ✘ | ✘ |

Au lancement, seul le rôle **admin** est utilisé ; les autres rôles sont prêts (`npm run admin:create -- --role commercial`).
Chaque page, action serveur et route `/api/admin/*` vérifie la session **côté serveur** (`requireUser` / `currentUser`).
Le client ne peut jamais confirmer lui-même une commande.

## Accès au site (pré-production / production)
Calcul unique dans `src/lib/site-mode.ts`, utilisé par le proxy **et** l'application :
1. `PREVIEW_PASSWORD` défini ⇒ authentification HTTP exigée partout, quel que soit `SITE_MODE` (le cron garde son propre secret) ;
2. `SITE_MODE=production` avec checklist incomplète ⇒ pages publiques en 503, `/admin` joignable ;
3. production effective seulement si toute la checklist est verte **et** le mot de passe retiré.

## Sécurité
- Aucun secret côté navigateur (seule `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, publique) — vérifié par un test E2E qui parcourt `.next/static`.
- Cookies de session `HttpOnly`, `SameSite=Strict`, `Secure` + préfixe `__Host-` en HTTPS ; actions serveur Next protégées contre le CSRF (contrôle d'origine) ; `POST /api/requests` vérifie `Origin`.
- En-têtes : CSP stricte (scripts limités au site + Turnstile), `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` ; `/admin` en `noindex` + `no-store`.
- Turnstile : `success`, nom d'hôte attendu **et** action `preorder` obligatoires ; jeton à usage unique (rejeu refusé par Cloudflare).
- Pièces jointes : type vérifié par signature binaire, taille limitée, chiffrement AES-256-GCM, téléchargement authentifié et journalisé.
- Requêtes SQL paramétrées (Drizzle) ; échappement HTML dans les emails ; neutralisation des formules dans l'export CSV ; suppression des caractères de contrôle.
- Journaux applicatifs sans coordonnées clients (emails masqués, aucune IP).

## RGPD (à valider par l'exploitant)
Finalités, bases légales, destinataires et durées proposées sont décrits dans `/confidentialite`. Données minimisées
(analytique sans cookie, IP hachée). Droit d'accès/suppression : recherche par email dans `/admin/demandes`, export CSV ;
la colonne `customers.anonymized_at` est prévue pour l'anonymisation (procédure manuelle au MVP, à automatiser en phase 2).
Hébergement : Vercel (fonctions à Paris `cdg1`), Supabase région UE, Resend (choisir la région UE).
