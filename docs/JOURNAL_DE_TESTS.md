# Journal de tests — résultats réels (V3.1)

Dernière exécution : **6 novembre 2026, V3.1** — V3 (audit V2 : P0-A, P0-B, P0-C, P1-A, P1-B) + corrections demandées par l'audit V3 (guide de mise en ligne, procédure de migration).
Environnement Linux isolé : Node 22.23, PostgreSQL 16.15 local et jetable, Chromium Playwright 1.63.
Bases `rc_test` et `rc_e2e` recréées à chaque exécution, migrations réelles 0000 → 0006. Emails : transport `file`.
**Aucune ressource externe** (Vercel, Supabase, Resend, Cloudflare, domaine) n'a été utilisée.

> Reproductible : `npm ci && npm run db:local && npm run lint && npm run typecheck && npm test && npm run test:e2e` (ou la CI GitHub fournie).
> Ces résultats **ne remplacent pas** la recette réelle sur Vercel + Supabase + Resend, qui reste à faire et à signer.

## Synthèse

| Contrôle | Résultat |
|---|---|
| Lint (ESLint, config Next 16) | ✅ 0 erreur, 0 avertissement |
| Typage strict | ✅ 0 erreur |
| Unitaires + intégration (vraie base PostgreSQL) | ✅ **69 / 69** (7 fichiers) |
| Build de production | ✅ (lancé par la suite E2E) |
| E2E sur 2 serveurs de production (normal + pré-production verrouillée), desktop 1280 / mobile 390 / mobile 375 | ✅ **61 / 61** (1,8 min) |
| Procédure de migration (manuel, base vierge locale) | ✅ `db:status` : 0/7 « non conforme » (code 2) → 2 `db:migrate` **simultanés** : l'un applique 0 → 7/7, l'autre attend le verrou puis « rien à appliquer » ; 7 entrées, 0 doublon → `db:status` « État conforme ✔ » ; `vercel-build` avec `VERCEL_ENV=preview` + `MIGRATE_ON_BUILD=true` : migration ignorée |

## Corrections de l'audit V2

| Point | Correction | Preuves |
|---|---|---|
| **P0-A** Contrôle avant relocation | Toute reprise (même « conforme ») met l'appareil **« à contrôler »** ; hors service reste hors service. Nouvelle action **Contrôle technique** (Matériel → Contrôle technique) : date/heure, contrôleur, 5 points (cordon/fiche, boîtier/stabilité, sécurités, essai de chauffe, propreté/notice), anomalies, décision neuf / bon / hors service ; rôles admin, préparateur, exploitant. Table `unit_inspections` immuable ; événement `controle` distinct de `reprise`. **Déclencheur PostgreSQL** : impossible de passer un appareil à neuf/bon sans inspection enregistrée dans la même transaction ; tout appareil créé entre « à contrôler ». La mise à l'écart manuelle ne peut plus que dégrader (motif obligatoire). « Neuf » interdit après une location. | `stock.test.ts` : « reprise conforme ≠ louable », « contrôle approuvé ⇒ louable », contrôle incomplet / rôle commercial / sans anomalies refusés, base qui refuse « bon » sans contrôle ; `recette.spec.ts` étapes 7-9 ; captures `controle-technique-*.png` |
| **P0-B** Preuve de remise | Constat qualifié : **notice par modèle** (remise / non remise), **signature** (signé / refus / non recueillie), **issue** conforme / avec réserves / incident. « Conforme » **impossible en base** sans signature ET toutes les notices. Notice non remise, refus ou absence de signature (remise ou reprise) ⇒ **incident obligatoire** (motif « qui, pourquoi » + consignes), visible au tableau de bord et sur la fiche jusqu'à sa résolution par un admin (motif requis, puis immuable). **Scan du bon signé** déposable au constat ou après coup (PDF/JPEG/PNG/WebP, signature binaire vérifiée), **chiffré AES-256-GCM** si `FILE_ENCRYPTION_KEY`, non supprimable, téléchargement authentifié et journalisé ; tuile « remises sans scan ». Procédure papier de refus imprimée sur le bon et rappelée dans le formulaire. Durées de conservation documentées dans `/confidentialite` (à valider). | `stock.test.ts` « P0-B » (scan sans clair en base et restitué à l'identique, incident refusé sans motif, notice de 2e modèle, résolution, immutabilité) ; `recette.spec.ts` étape 6 (refus de signature, incident, scan déposé puis déchiffré par le serveur, incident résolu) ; captures `recette-constat-remise-incident`, `recette-constats-incident-resolu` |
| **P0-C** Fermeture de la pré-production | Calcul **unique** (`src/lib/site-mode.ts`) utilisé par le proxy et l'application : `PREVIEW_PASSWORD` présent ⇒ authentification exigée **partout, quel que soit `SITE_MODE`** ; sa présence empêche aussi le mode production effectif. `SITE_MODE=production` + checklist incomplète + pas de mot de passe ⇒ pages publiques en 503, `/admin` joignable. | `access.test.ts` (dont le cas exact de l'audit via le vrai proxy) ; **`preprod-lock.spec.ts` sur un second serveur de production réel** (`SITE_MODE=production`, `LEGAL_TEXTS_VALIDATED=false`, `PREVIEW_PASSWORD`) : 401 sur `/`, `/demande`, `/admin/login`, `/api/admin/export`, `POST /api/requests`, mauvais mot de passe ; 200 + bandeau + noindex avec le bon ; capture `preprod-verrouillee-preprod-lock.png` |
| **P1-A** Turnstile | `action === "preorder"` **obligatoire**, hôte vérifié ; jeton réutilisé refusé (Cloudflare `timeout-or-duplicate`). | `access.test.ts` : absence d'action, mauvaise action, autre hôte, jeton rejoué, absence de jeton |
| **P1-B** Écarts de quantité | Bon : « Quantité confirmée · préparée sur ce bon · **reste à livrer** (commande partiellement exécutée) » + rappel que la quantité **effectivement remise** est celle inscrite sur place ; notice affichée par modèle. Fiche : compteurs confirmé / affectés non remis / **remis** / chez le client / repris, badge « exécution partielle x/y » tant que tout n'est pas remis. | `stock.test.ts` « P0-3 / P1-B » (texte du PDF vérifié) ; `recette.spec.ts` (badge 2/3 puis disparition) |

### V3.1 — corrections demandées par l'audit V3 (sans réécriture de l'application)
- `docs/MISE_EN_LIGNE.md` étape 8 : la demande test livrée puis reprise est **clôturée** (note « DEMANDE DE TEST »), pas annulée ; l'**annulation** se teste sur une **seconde** demande confirmée jamais remise. Les deux comportements sont couverts par un test (`stock.test.ts` : annulation d'une demande non livrée → réservation annulée et tracée, appareil affectable sans contrôle ; annulation refusée après livraison/clôture).
- Même étape : après reprise, les appareils sont **« à contrôler »** et ne redeviennent louables qu'après le **contrôle technique** (la phrase erronée a été remplacée). L'étape 7 bis (contrôle de réception) est replacée avant l'étape 8.
- Nouvelle **étape 5 bis** : migration **une seule fois par environnement**, manuelle, après sauvegarde, tracée, avec vérification `npm run db:status` des garde-fous 0004-0006 ; `MIGRATE_ON_BUILD=false` par défaut ; variables *Preview* et *Production* séparées. Risques des migrations concurrentes expliqués.
- Scripts (pas l'application) : `scripts/migrate.ts` prend un **verrou PostgreSQL** et vérifie les garde-fous ; nouveau `npm run db:status` ; `scripts/vercel-build.mjs` **refuse de migrer depuis un déploiement Preview**.

Autres : tuile « Demandes > 24 h sans contact » (P1-C), alertes incidents / scans manquants / appareils à contrôler, page de confidentialité complétée (conservation des scans).

## Ce qui n'est PAS testé ici — à faire par l'exploitant
- **Recette réelle** sur Vercel + Supabase + Resend **neufs** (voir `RECETTE_PARCOURS.md`, étapes 0 à 14 + liste finale), migrations appliquées par la procédure de l'étape 5 bis : vrais emails, vraie base, Turnstile réel, fermeture vérifiée en navigation privée.
- Sauvegarde **et restauration** sur une autre base ; impression A4 réelle, scan depuis un téléphone, test mobile réel.
- Lighthouse et audit d'accessibilité automatisé (axe) non lancés ; audit de sécurité externe non réalisé.
- Rotation de la clé `FILE_ENCRYPTION_KEY` non outillée (procédure à prévoir si nécessaire) ; récupération de mot de passe par email non prévue (réinitialisation par un admin).
- Juridique : `LEGAL_TEXTS_VALIDATED=true` reste une **déclaration**. Mentions, CGV B2B/B2C, responsabilités, RGPD et assurance doivent être validés par un juriste et l'assureur. Le bon prouve la remise, la notice et l'état ; il n'exonère pas le loueur.
- Matériel : référence VARMA/Ingaro 244177 et notice à vérifier physiquement ; ce sont des données de démonstration.
- **Aucune annonce « prêt pour la production »** : l'ouverture exige la recette réelle signée par le responsable de l'activité.

## Détail des tests

### Vitest (unitaires + intégration) — 69 / 69
```
 ✓ tests/integration/stock.test.ts > P0-1 — disponibilité physique > retard de 7 jours + commande concurrente : RC-001 ne peut pas être promis ; disponible seulement après reprise ET contrôle
 ✓ tests/integration/stock.test.ts > P0-1 — disponibilité physique > concurrence : deux demandes affectent RC-002 en même temps → une seule réussit
 ✓ tests/integration/stock.test.ts > P0-1 — disponibilité physique > prolongation transactionnelle et tracée ; appareil remis non libérable
 ✓ tests/integration/stock.test.ts > Guide de mise en ligne — scénarios de test « clôture » et « annulation » > annuler une demande confirmée jamais livrée annule ses réservations (tracé) et rend l'appareil affectable sans contrôle
 ✓ tests/integration/stock.test.ts > P0-A — contrôle technique avant toute nouvelle location > ni l'application ni la base ne permettent de rendre un appareil louable sans contrôle
 ✓ tests/integration/stock.test.ts > P0-B — preuve de remise : notice par modèle, signature, incidents, scan chiffré > remise conforme : bon signé + notices ; scan stocké chiffré et restitué à l'identique
 ✓ tests/integration/stock.test.ts > P0-B — preuve de remise : notice par modèle, signature, incidents, scan chiffré > notice NON remise et refus de signature : incident obligatoire, jamais « conforme », résolution tracée par un admin
 ✓ tests/integration/stock.test.ts > P0-2 — parcours complet avec contrôle > 3 appareils → remise réelle → reprise partielle (1 dégradé) → reprise complète → contrôles → parc disponible
 ✓ tests/integration/stock.test.ts > P0-2 — parcours complet avec contrôle > refuse une date réelle future, une reprise antérieure à la remise, un écart non justifié, une photo invalide
 ✓ tests/integration/stock.test.ts > P0-3 / P1-B — cohérence quantité / modèles / état et exécution partielle > refus : hors service, doublons, autre modèle non justifié, dépassement ; bon multi-lignes avec « reste à livrer »
 ✓ tests/integration/backoffice.test.ts > back-office : statuts et droits > le commercial ne peut pas confirmer ; l'admin oui, après contrôles
 ✓ tests/integration/backoffice.test.ts > back-office : statuts et droits > la confirmation exige un créneau de livraison
 ✓ tests/integration/backoffice.test.ts > bon de remise et de reprise (PDF) > recettes 7-10 : 3 appareils VARMA/Ingaro 244177, PDF A4 1 page, prérempli sans champs factuels
 ✓ tests/integration/backoffice.test.ts > bon de remise et de reprise (PDF) > au-delà de 12 appareils : annexe d'inventaire sur une 2e page
 ✓ tests/integration/backoffice.test.ts > bon de remise et de reprise (PDF) > refuse de générer un bon pour une demande non confirmée
 ✓ tests/integration/backoffice.test.ts > authentification admin > connexion, session, verrouillage après 5 échecs
 ✓ tests/integration/preorders.test.ts > création de précommande > recette 2 : pro pour une autre adresse et un autre réceptionnaire — données distinctes en base
 ✓ tests/integration/preorders.test.ts > création de précommande > recette 3 : 5 × 14 jours Lyon figé à 559 € HT / 670,80 € TTC
 ✓ tests/integration/preorders.test.ts > création de précommande > idempotence : même clé deux fois = une seule demande
 ✓ tests/integration/preorders.test.ts > création de précommande > références générées atomiquement, sans doublon en parallèle
 ✓ tests/integration/preorders.test.ts > création de précommande > recette 4 : climatisation → lead complet, « sur devis », aucun prix
 ✓ tests/integration/preorders.test.ts > création de précommande > un changement de grille n'affecte pas les demandes existantes (prix figé + trigger d'immuabilité)
 ✓ tests/integration/preorders.test.ts > notifications (outbox + retry) > recette 5 : si l'email échoue, la demande est conservée et la notification retentée sans double envoi
 ✓ tests/integration/preorders.test.ts > notifications (outbox + retry) > l'email client contient les mentions obligatoires et le réceptionnaire distinct
 ✓ tests/integration/preorders.test.ts > notifications (outbox + retry) > passe en « dead » après le nombre maximal de tentatives
 ✓ tests/integration/preorders.test.ts > panne de base de données > recette 12 (serveur) : base injoignable → erreur de connexion détectée, aucune demande inventée
 ✓ tests/integration/preorders.test.ts > anti-chevauchement du parc (règle physique, migration 0004) > un appareil n'a jamais deux affectations ouvertes, même sur des périodes PRÉVUES disjointes ; historique physique sans chevauchement
 ✓ tests/integration/migration-0004.test.ts > migration 0004 sur des données existantes (reprise explicite et tracée) > convertit l'ancien mécanisme de libération sans perte ni modification silencieuse
 ✓ tests/unit/domain.test.ts > configuration métier > la configuration par défaut est valide
 ✓ tests/unit/domain.test.ts > estimation chauffage > recette 1 : 25 m², 1 pièce, bonne isolation, 2,5 m → 1 appareil 2 000 W
 ✓ tests/unit/domain.test.ts > estimation chauffage > recette 1 bis : il peut en choisir 2, avec avertissement électrique
 ✓ tests/unit/domain.test.ts > estimation chauffage > isolation moyenne : 20 m² par appareil ; faible : ~16,7 m²
 ✓ tests/unit/domain.test.ts > estimation chauffage > calcule par pièce : 2 pièces de 10 m² → 2 appareils (pas 1)
 ✓ tests/unit/domain.test.ts > estimation chauffage > surface totale répartie : avertissement de précision
 ✓ tests/unit/domain.test.ts > estimation chauffage > hauteur 3 m : facteur 1,2 ; hauteur 4 m → devis manuel
 ✓ tests/unit/domain.test.ts > estimation chauffage > ne valide jamais automatiquement 10 appareils dans un même appartement
 ✓ tests/unit/domain.test.ts > estimation chauffage > ERP / école : revue manuelle obligatoire
 ✓ tests/unit/domain.test.ts > estimation chauffage > isolation inconnue : hypothèse prudente (moyenne) signalée
 ✓ tests/unit/domain.test.ts > tarification chauffage > recette 3 : 5 radiateurs × 14 jours Lyon = 559 € HT / 670,80 € TTC
 ✓ tests/unit/domain.test.ts > tarification chauffage > 3 radiateurs × 7 jours = 256 € HT
 ✓ tests/unit/domain.test.ts > tarification chauffage > Villeurbanne 69100 est dans la zone
 ✓ tests/unit/domain.test.ts > tarification chauffage > bornes de paliers : 1, 3, 4, 7, 8, 14, 15, 28 jours
 ✓ tests/unit/domain.test.ts > tarification chauffage > sur devis : > 28 jours, durée inconnue, hors zone, 9+ appareils, multi-sites, ERP
 ✓ tests/unit/domain.test.ts > tarification chauffage > l'express n'est JAMAIS ajouté au total estimé
 ✓ tests/unit/domain.test.ts > tarification chauffage > climatisation : toujours sur devis, sans prix
 ✓ tests/unit/domain.test.ts > tarification chauffage > TVA non applicable : TTC = HT
 ✓ tests/unit/domain.test.ts > estimation climatisation > donne une fourchette indicative et des points de faisabilité
 ✓ tests/unit/domain.test.ts > statuts > seul un admin peut confirmer, après tous les contrôles
 ✓ tests/unit/domain.test.ts > statuts > ERP : contrôle supplémentaire requis
 ✓ tests/unit/domain.test.ts > statuts > on ne saute pas de la nouvelle demande à confirmée
 ✓ tests/unit/domain.test.ts > validation > SIRET : clé de Luhn
 ✓ tests/unit/domain.test.ts > validation > refuse un SIRET pour un particulier et exige la raison sociale d'un pro
 ✓ tests/unit/domain.test.ts > validation > supprime les caractères de contrôle
 ✓ tests/unit/domain.test.ts > dates Europe/Paris > gère heure d'été / heure d'hiver
 ✓ tests/unit/domain.test.ts > jours de location constatés > aucune règle validée → null (on n'invente pas de décompte)
 ✓ tests/unit/domain.test.ts > jours de location constatés > jours calendaires inclusifs, robustes au changement d'heure
 ✓ tests/unit/domain.test.ts > jours de location constatés > périodes de 24 h entamées
 ✓ tests/unit/domain.test.ts > jours de location constatés > refuse une reprise antérieure à la remise
 ✓ tests/integration/api-db-down.test.ts > API /api/requests (gestionnaire réel) > recette 12 : base injoignable → HTTP 503 explicite, jamais de référence
 ✓ tests/integration/api-db-down.test.ts > API /api/requests (gestionnaire réel) > refuse une origine étrangère, un JSON invalide et un honeypot rempli
 ✓ tests/unit/access.test.ts > P0-C — fermeture de la pré-production > cas de l'audit : SITE_MODE=production + LEGAL_TEXTS_VALIDATED=false + PREVIEW_PASSWORD ⇒ 401 sans authentification
 ✓ tests/unit/access.test.ts > P0-C — fermeture de la pré-production > le mot de passe est exigé même si toute la checklist est verte, et sa présence empêche le mode production effectif
 ✓ tests/unit/access.test.ts > P0-C — fermeture de la pré-production > SITE_MODE=production + checklist incomplète + pas de mot de passe ⇒ site public fermé (503), admin joignable
 ✓ tests/unit/access.test.ts > P0-C — fermeture de la pré-production > ouverture commerciale effective seulement si tout est vert et le mot de passe retiré ; le cron reste joignable
 ✓ tests/unit/access.test.ts > P1-A — Turnstile : action obligatoire, hôte vérifié > accepte uniquement success + bon hôte + action « preorder »
 ✓ tests/unit/access.test.ts > P1-A — Turnstile : action obligatoire, hôte vérifié > refuse une réponse sans action
 ✓ tests/unit/access.test.ts > P1-A — Turnstile : action obligatoire, hôte vérifié > refuse une mauvaise action
 ✓ tests/unit/access.test.ts > P1-A — Turnstile : action obligatoire, hôte vérifié > refuse un autre nom d'hôte
 ✓ tests/unit/access.test.ts > P1-A — Turnstile : action obligatoire, hôte vérifié > refuse un jeton déjà utilisé (Cloudflare : timeout-or-duplicate) et l'absence de jeton
```

### Playwright (E2E sur build de production) — 61 / 61
```
  ✓   1 [desktop] › tests/e2e/admin.spec.ts:20:1 › recette 13 : sans authentification, aucune donnée client ni document n'est accessible
  ✓   2 [desktop] › tests/e2e/admin.spec.ts:40:1 › recette 13 bis : aucune clé serveur dans le bundle public
  ✓   3 [desktop] › tests/e2e/admin.spec.ts:51:1 › recette 2 : un professionnel commande pour une autre adresse et un autre réceptionnaire (5 × 14 j = 559 € HT / 670,80 € TTC)
  ✓   4 [desktop] › tests/e2e/admin.spec.ts:96:1 › recettes 5, 7, 8, 10 : la demande apparaît dans l'admin, qualification, devis, confirmation, affectation, bon PDF
  ✓   5 [desktop] › tests/e2e/admin.spec.ts:188:1 › recette 6 : export CSV protégé, aucun paiement / facture dans l'admin
  ✓   6 [desktop] › tests/e2e/preorder.spec.ts:14:3 › tunnel de précommande › recette 1 : particulier 25 m², 1 pièce, bonne isolation → 1 radiateur ; il en choisit 2 avec avertissement ; envoi réel
  ✓   7 [desktop] › tests/e2e/preorder.spec.ts:60:3 › tunnel de précommande › recette 4 : climatisation → lead complet « sur devis », sans faux prix
  ✓   8 [desktop] › tests/e2e/preorder.spec.ts:94:3 › tunnel de précommande › recette 12 : API/base en panne → échec visible, aucune fausse réussite, saisie conservée
  ✓   9 [desktop] › tests/e2e/preorder.spec.ts:129:3 › tunnel de précommande › accessibilité clavier : premier écran utilisable au clavier
  ✓  10 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page / : chargement, pas de débordement, pas de fausse promesse
  ✓  11 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /chauffage : chargement, pas de débordement, pas de fausse promesse
  ✓  12 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /climatisation : chargement, pas de débordement, pas de fausse promesse
  ✓  13 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /professionnels : chargement, pas de débordement, pas de fausse promesse
  ✓  14 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /demande : chargement, pas de débordement, pas de fausse promesse
  ✓  15 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /mentions-legales : chargement, pas de débordement, pas de fausse promesse
  ✓  16 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /confidentialite : chargement, pas de débordement, pas de fausse promesse
  ✓  17 [desktop] › tests/e2e/public.spec.ts:8:5 › site public › page /conditions : chargement, pas de débordement, pas de fausse promesse
  ✓  18 [desktop] › tests/e2e/public.spec.ts:21:3 › site public › accueil : deux choix clairs et CTA vers le simulateur
  ✓  19 [desktop] › tests/e2e/public.spec.ts:30:3 › site public › chauffage : simulateur immédiat sur la page
  ✓  20 [desktop] › tests/e2e/public.spec.ts:38:3 › site public › climatisation : sur devis, aucun prix affiché
  ✓  21 [desktop] › tests/e2e/public.spec.ts:45:3 › site public › pré-production : non indexé
  ✓  22 [desktop] › tests/e2e/public.spec.ts:52:3 › site public › pages légales : modèles marqués non publiables tant que l'identité manque
  ✓  23 [desktop] › tests/e2e/recette.spec.ts:25:1 › 1. Un particulier envoie une précommande (3 pièces → 3 radiateurs)
  ✓  24 [desktop] › tests/e2e/recette.spec.ts:47:1 › 2-5. Appel, devis, confirmation, 3 appareils distincts, bon PDF
  ✓  25 [desktop] › tests/e2e/recette.spec.ts:112:1 › 6. Remise PARTIELLE avec refus de signature : incident obligatoire, puis remise du 3e conforme avec scan
  ✓  26 [desktop] › tests/e2e/recette.spec.ts:179:1 › 7. Reprise PARTIELLE (2 sur 3, un dégradé) : les 2 repris attendent le contrôle, le 3e reste bloqué
  ✓  27 [desktop] › tests/e2e/recette.spec.ts:203:1 › 8. Contrôle technique : RC-006 approuvé ⇒ disponible ; RC-007 ⇒ hors service
  ✓  28 [desktop] › tests/e2e/recette.spec.ts:213:1 › 9. Reprise complète → « Reprise effectuée », contrôle, clôture, parc disponible
  ✓  29 [preprod-lock] › tests/e2e/preprod-lock.spec.ts:8:1 › pré-production verrouillée malgré SITE_MODE=production : 401 sans mot de passe
  ✓  30 [preprod-lock] › tests/e2e/preprod-lock.spec.ts:20:1 › avec le mot de passe : accès, bandeau pré-production et non-indexation
  ✓  31 [preprod-lock] › tests/e2e/preprod-lock.spec.ts:31:1 › la tâche planifiée reste joignable (protégée par son propre secret)
  ✓  32 [mobile-390] › tests/e2e/preorder.spec.ts:14:3 › tunnel de précommande › recette 1 : particulier 25 m², 1 pièce, bonne isolation → 1 radiateur ; il en choisit 2 avec avertissement ; envoi réel
  ✓  33 [mobile-390] › tests/e2e/preorder.spec.ts:60:3 › tunnel de précommande › recette 4 : climatisation → lead complet « sur devis », sans faux prix
  ✓  34 [mobile-390] › tests/e2e/preorder.spec.ts:94:3 › tunnel de précommande › recette 12 : API/base en panne → échec visible, aucune fausse réussite, saisie conservée
  ✓  35 [mobile-390] › tests/e2e/preorder.spec.ts:129:3 › tunnel de précommande › accessibilité clavier : premier écran utilisable au clavier
  ✓  36 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page / : chargement, pas de débordement, pas de fausse promesse
  ✓  37 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /chauffage : chargement, pas de débordement, pas de fausse promesse
  ✓  38 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /climatisation : chargement, pas de débordement, pas de fausse promesse
  ✓  39 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /professionnels : chargement, pas de débordement, pas de fausse promesse
  ✓  40 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /demande : chargement, pas de débordement, pas de fausse promesse
  ✓  41 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /mentions-legales : chargement, pas de débordement, pas de fausse promesse
  ✓  42 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /confidentialite : chargement, pas de débordement, pas de fausse promesse
  ✓  43 [mobile-390] › tests/e2e/public.spec.ts:8:5 › site public › page /conditions : chargement, pas de débordement, pas de fausse promesse
  ✓  44 [mobile-390] › tests/e2e/public.spec.ts:21:3 › site public › accueil : deux choix clairs et CTA vers le simulateur
  ✓  45 [mobile-390] › tests/e2e/public.spec.ts:30:3 › site public › chauffage : simulateur immédiat sur la page
  ✓  46 [mobile-390] › tests/e2e/public.spec.ts:38:3 › site public › climatisation : sur devis, aucun prix affiché
  ✓  47 [mobile-390] › tests/e2e/public.spec.ts:45:3 › site public › pré-production : non indexé
  ✓  48 [mobile-390] › tests/e2e/public.spec.ts:52:3 › site public › pages légales : modèles marqués non publiables tant que l'identité manque
  ✓  49 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page / : chargement, pas de débordement, pas de fausse promesse
  ✓  50 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /chauffage : chargement, pas de débordement, pas de fausse promesse
  ✓  51 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /climatisation : chargement, pas de débordement, pas de fausse promesse
  ✓  52 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /professionnels : chargement, pas de débordement, pas de fausse promesse
  ✓  53 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /demande : chargement, pas de débordement, pas de fausse promesse
  ✓  54 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /mentions-legales : chargement, pas de débordement, pas de fausse promesse
  ✓  55 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /confidentialite : chargement, pas de débordement, pas de fausse promesse
  ✓  56 [mobile-375] › tests/e2e/public.spec.ts:8:5 › site public › page /conditions : chargement, pas de débordement, pas de fausse promesse
  ✓  57 [mobile-375] › tests/e2e/public.spec.ts:21:3 › site public › accueil : deux choix clairs et CTA vers le simulateur
  ✓  58 [mobile-375] › tests/e2e/public.spec.ts:30:3 › site public › chauffage : simulateur immédiat sur la page
  ✓  59 [mobile-375] › tests/e2e/public.spec.ts:38:3 › site public › climatisation : sur devis, aucun prix affiché
  ✓  60 [mobile-375] › tests/e2e/public.spec.ts:45:3 › site public › pré-production : non indexé
  ✓  61 [mobile-375] › tests/e2e/public.spec.ts:52:3 › site public › pages légales : modèles marqués non publiables tant que l'identité manque
```
