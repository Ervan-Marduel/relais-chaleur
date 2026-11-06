# Guide « Je le mets en ligne »

Guide pas à pas pour une personne non développeuse. Durée : 1 h à 2 h la première fois.

**Règles de sécurité**
- Créez **de nouveaux comptes / projets** dédiés à Relais Chaleur. N'utilisez **aucun** projet, base, clé ou compte
  existant d'une autre activité (EMH, VSTONE, L'Assistant, APLOMB…).
- Les secrets (mots de passe, clés) se collent **uniquement** dans les écrans de Vercel / Supabase / Resend.
  Ne les envoyez jamais par chat, email, ni dans un fichier ZIP. Ne les ajoutez jamais au dépôt Git.
- Pour générer un secret : sur Mac/Linux, ouvrez le Terminal et tapez `openssl rand -base64 48` ;
  sinon utilisez le générateur de mots de passe de votre gestionnaire (48 caractères, sans espace).

---

## Étape 1 — Mettre le code sur GitHub (5 min)
1. Créez un compte GitHub (ou utilisez celui de la société) puis **New repository** → nom `relais-chaleur-lyon`, **Private**.
2. Envoyez le dossier du projet dans ce dépôt (votre développeur peut le faire avec `git push`, ou utilisez
   « uploading an existing file » depuis la page du dépôt). Le fichier `.env.local` ne doit **pas** être envoyé.

## Étape 2 — Créer la base de données Supabase (10 min)
1. Allez sur supabase.com → **New project**. Organisation : nouvelle, au nom de la société.
2. Nom : `relais-chaleur-prod`. Région : **West EU (Paris)**. Choisissez un mot de passe de base fort et gardez-le dans votre gestionnaire.
3. Une fois le projet prêt : **Project Settings → Database → Connection string**.
   - Copiez l'URL **Transaction pooler** (port **6543**) → ce sera `DATABASE_URL`.
   - Copiez l'URL **Direct connection** / **Session pooler** (port **5432**) → ce sera `MIGRATION_DATABASE_URL`.
   - Remplacez `[YOUR-PASSWORD]` par le mot de passe de l'étape 2.
4. (Recommandé) Créez aussi un **second projet** `relais-chaleur-preprod` pour les essais, avec ses propres URL.
5. Sauvegardes : vérifiez dans **Database → Backups** que les sauvegardes quotidiennes sont actives (offre payante recommandée pour la restauration à un instant donné).

> L'application n'utilise ni la clé « anon » ni la clé « service_role » de Supabase. Toutes les tables ont la
> sécurité par ligne (RLS) activée sans règle : l'API Supabase ne donne accès à rien.

## Étape 3 — Configurer les emails Resend (15 min + délai DNS)
1. Créez un compte sur resend.com (au nom de la société).
2. **Domains → Add domain** → saisissez un sous-domaine d'envoi, par ex. `mail.votre-domaine.fr`. Région UE si proposée.
3. Resend affiche des enregistrements DNS (SPF, DKIM, éventuellement MX/DMARC). Ajoutez-les chez votre registrar
   (OVH, Gandi, IONOS…) dans la zone DNS du domaine. Attendez que Resend indique **Verified**.
4. **API Keys → Create API key** → permission *Sending access*, domaine limité au vôtre → copiez la clé (`RESEND_API_KEY`).
5. Choisissez :
   - l'expéditeur : `EMAIL_FROM="Relais Chaleur Lyon <demandes@mail.votre-domaine.fr>"` ;
   - l'adresse **dédiée** qui reçoit les nouvelles demandes : `TEAM_NOTIFICATION_EMAIL=demandes@votre-domaine.fr` ;
   - éventuellement `EMAIL_REPLY_TO=contact@votre-domaine.fr`.

## Étape 4 — (Recommandé) Anti-robot Cloudflare Turnstile (5 min)
1. dash.cloudflare.com → **Turnstile → Add widget** → domaine du site, mode *Managed*.
2. Copiez la **Site key** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, publique) et la **Secret key** (`TURNSTILE_SECRET_KEY`).

## Étape 5 — Créer le projet Vercel (10 min)
1. vercel.com → créez une **nouvelle équipe** au nom de la société. ⚠️ L'offre gratuite *Hobby* est réservée à un usage
   non commercial : pour un site commercial, prenez l'offre **Pro**.
2. **Add New → Project → Import** le dépôt GitHub `relais-chaleur-lyon`. Framework détecté : Next.js. Ne cliquez pas encore sur *Deploy*.
3. Ouvrez **Environment Variables**. Chaque variable se coche **par environnement** : saisissez les valeurs de la base de
   **pré-production** pour *Preview* et celles de la base de **production** pour *Production*. Une variable de production ne doit
   jamais être cochée pour *Preview* (sinon un déploiement de test pourrait écrire dans la base réelle).

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URL pooler Supabase (port 6543) |
| `MIGRATION_DATABASE_URL` | URL directe (port 5432) |
| `MIGRATE_ON_BUILD` | `false` (recommandé, voir étape 5 bis). Ne jamais le mettre à `true` pour *Preview* : le script l'ignore de toute façon |
| `APP_URL` | `https://votre-domaine.fr` (provisoirement l'URL `….vercel.app`) |
| `SITE_MODE` | `preproduction` pour commencer |
| `PREVIEW_PASSWORD` | mot de passe qui ferme **tout** le site (navigateur : identifiant libre + ce mot de passe). Il s'applique même si `SITE_MODE=production` ; à retirer seulement le jour de l'ouverture |
| `SESSION_SECRET`, `HASH_SALT`, `CRON_SECRET` | 3 secrets différents générés |
| `FILE_ENCRYPTION_KEY` | `openssl rand -base64 32` — chiffre les scans de bons signés et photos ; **à conserver précieusement** (perte = fichiers illisibles) |
| `ADMIN_SETUP_TOKEN` | un secret (à supprimer après l'étape 7) |
| `EMAIL_DRIVER` | `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM`, `TEAM_NOTIFICATION_EMAIL`, `EMAIL_REPLY_TO` | étape 3 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | étape 4 |
| `LEGAL_*`, `PUBLIC_PHONE`, `BRAND_NAME` | identité légale (voir CHECKLIST_OUVERTURE) — peut attendre |

4. **Avant** de cliquer sur *Deploy*, appliquez les migrations sur la base visée (étape 5 bis). Puis cliquez **Deploy**.
   Le build ne touche pas à la base. Si le site affiche une erreur de base, vérifiez `DATABASE_URL` et lancez `npm run db:status` (étape 5 bis).
5. Région des fonctions : `vercel.json` fixe `cdg1` (Paris). La tâche planifiée `/api/cron/notifications` relance les emails en échec
   (1 fois/jour, limite de l'offre Hobby ; en **Pro**, passez `schedule` à `*/10 * * * *` dans `vercel.json`).
   Les emails partent aussi immédiatement après chaque demande et à chaque ouverture du tableau de bord.

## Étape 5 bis — Migrations de base : UNE exécution contrôlée par environnement
Les migrations modifient la structure de la base. Elles doivent être appliquées **une seule fois par environnement**, par une
personne identifiée, **après sauvegarde**, jamais par plusieurs déploiements en parallèle.

**Pourquoi pas automatiquement à chaque build ?** Plusieurs déploiements Vercel peuvent se lancer en même temps (push successifs,
« Redeploy », branches). Deux migrations concurrentes sur la même base peuvent se gêner ; un déploiement *Preview* mal configuré
pourrait migrer la base de production ; et un build ne laisse pas de trace claire de « qui a migré quoi, quand ». Le script de
migration prend désormais un **verrou PostgreSQL** (une seconde exécution attend puis ne fait rien) et refuse de migrer depuis un
déploiement *Preview*, mais la procédure ci-dessous reste la règle.

**Procédure (à faire par la personne responsable, depuis un seul poste, Node.js 20+ installé, projet cloné) :**
1. **Sauvegarde** : Supabase → Database → Backups → vérifier qu'une sauvegarde récente existe (ou en déclencher une).
   Sur une base vierge (premier déploiement), cette étape peut être sautée.
2. Ouvrez un terminal dans le dossier du projet, `npm ci`, puis renseignez l'URL **directe** (port 5432) de l'environnement visé
   **uniquement dans ce terminal** (jamais dans un fichier) :
   `export MIGRATION_DATABASE_URL="postgres://…:5432/postgres"` (Windows PowerShell : `$env:MIGRATION_DATABASE_URL="…"`).
3. État avant : `npm run db:status` → affiche « migrations appliquées : X/7 ».
4. Migration : `npm run db:migrate` → doit afficher « Migrations appliquées ✔ (X → 7/7) » puis cinq ✔, dont
   « déclencheur contrôle technique obligatoire (0006) » et « contrainte remise conforme = signature + notice (0006) ».
5. Paramètres initiaux (base vierge seulement) : `npm run db:seed` (**jamais** `--demo` en production).
6. Vérification finale : `npm run db:status` → « État conforme ✔ ».
7. **Tracez** l'opération (date, heure, environnement, personne, sortie de la commande) dans votre registre d'exploitation.
8. Fermez le terminal (l'URL et son mot de passe disparaissent avec lui).

Ordre : d'abord la **pré-production**, recette, puis la **production** avec la même procédure. Pour une future mise à jour du code
contenant une nouvelle migration : sauvegarde → migration contrôlée → déploiement. Les migrations de ce projet sont additives
(elles ajoutent sans supprimer), ce qui permet de revenir au code précédent sans annuler la migration.

> Alternative possible pour le **tout premier** déploiement sur une base vierge : `MIGRATE_ON_BUILD=true` sur l'environnement
> *Production* uniquement, le temps d'un seul déploiement, puis remise à `false` immédiatement après. Vérifiez ensuite avec `npm run db:status`.

## Étape 6 — Brancher le domaine (10 min + DNS)
1. Vercel → **Settings → Domains → Add** `votre-domaine.fr` (et `www`). Suivez les instructions DNS (enregistrement A / CNAME).
2. Attendez le cadenas HTTPS, puis mettez `APP_URL=https://votre-domaine.fr` et **Redeploy**.

## Étape 7 — Créer votre compte administrateur (2 min)
1. Ouvrez `https://votre-domaine.fr/admin/setup`.
2. Saisissez le jeton `ADMIN_SETUP_TOKEN`, votre nom, email et un mot de passe de 12 caractères minimum.
3. Connectez-vous sur `/admin/login`. Puis **supprimez la variable `ADMIN_SETUP_TOKEN`** dans Vercel et redéployez
   (la page est de toute façon désactivée dès qu'un administrateur existe).
4. Dans **Matériel** : créez le modèle réellement acheté (marque, modèle, référence, puissance, notice) et ajoutez vos appareils
   (codes RC-001… générés ; n° de série seulement s'il existe sur l'appareil).
5. Dans **Tarifs & paramètres** : vérifiez la grille, publiez une version si besoin.

## Étape 7 bis — Contrôle de réception du matériel
Chaque appareil créé entre « à contrôler ». Dans **Matériel → Contrôle technique**, contrôlez chaque appareil (cordon, fiche,
stabilité, sécurités, essai de chauffe, propreté/notice) et choisissez « Neuf » ou « Bon pour la location ». Un appareil n'est
proposé à l'affectation qu'après ce contrôle. Après chaque retour, le même contrôle est obligatoire avant toute nouvelle location.

## Étape 8 — Faire une vraie demande test (20 min)
0. Vérifiez la fermeture : dans une fenêtre de navigation privée, `https://votre-domaine.fr` doit demander un mot de passe (401) sans lequel rien ne s'affiche.
1. Sur le site, faites une demande avec **votre** email (ex. 25 m², 1 pièce, Lyon 69003, 7 jours).
2. Vérifiez : la référence `RC-AAAA-000001` s'affiche ; vous recevez l'accusé ; l'adresse `TEAM_NOTIFICATION_EMAIL` reçoit l'alerte.
3. Dans `/admin` : la demande apparaît. Notez un appel, créez un devis, renseignez la date de livraison, la quantité confirmée et le modèle,
   confirmez (cases de contrôle), affectez les appareils, passez en préparation, cliquez **Générer le bon**. Ouvrez le PDF sur ordinateur
   **et** sur téléphone ; imprimez-le en A4 (échelle 100 %).
4. Après la livraison : **constat de remise** (date et heure réelles, notice par modèle, signature) et dépôt du **scan du bon signé**.
5. Après la reprise : **constat de reprise**. Les appareils repris passent **« à contrôler »** : ils ne sont **pas** louables à ce stade,
   même s'ils paraissent en bon état. Faites le **contrôle technique** de chacun (Matériel → Contrôle technique, étape 7 bis) :
   c'est seulement après un contrôle positif qu'ils redeviennent disponibles.
6. Si l'email n'arrive pas : `/admin/notifications` affiche l'erreur exacte (domaine non vérifié, clé invalide…). Corrigez puis « Traiter la file maintenant ».
7. **Clôturez** la demande test (statut « Clôturée ») et ajoutez une note interne « DEMANDE DE TEST — ne pas facturer ».
   Une demande déjà livrée **ne peut pas** être annulée : c'est voulu (le matériel a quitté le dépôt, l'historique doit rester exact).
8. Pour tester l'**annulation**, créez une **seconde** demande test, confirmez-la et affectez-lui un appareil **sans** la livrer, puis passez-la
   en « Annulée » (motif dans la note) : la réservation est annulée et tracée, l'appareil redevient affectable immédiatement
   (il n'a jamais quitté le dépôt, aucun contrôle n'est requis).

## Étape 8 bis — Recette complète en pré-production
Rejouez le parcours de [`RECETTE_PARCOURS.md`](RECETTE_PARCOURS.md) de bout en bout avec un vrai bon imprimé :
précommande → appel → confirmation → 3 appareils → bon → constat de remise → reprise partielle → **contrôle technique** → reprise complète
→ **contrôle technique** → parc disponible → clôture (et annulation sur une seconde commande jamais remise).
Testez aussi : un compte « commercial » (droits limités, désactivation), une panne email volontaire, la restauration d'une sauvegarde.

## Étape 9 — Passer en production commerciale
1. Complétez toutes les variables `LEGAL_*`, faites relire CGL et confidentialité (juriste + assureur), puis `LEGAL_TEXTS_VALIDATED=true`.
2. Mettez `SITE_MODE=production`, supprimez `PREVIEW_PASSWORD` (sa présence maintient volontairement le site fermé), redéployez.
   Si `SITE_MODE=production` mais qu'un élément de la checklist manque, les pages publiques affichent « Site en préparation » (503) et seul `/admin` reste accessible.
3. Dans `/admin` → encadré **Ouverture commerciale** : toutes les lignes doivent être vertes et le mode effectif « production ».
   Sinon le site reste automatiquement en pré-production (non indexé, bandeau visible).
4. Déclarez le site dans Google Search Console et soumettez `https://votre-domaine.fr/sitemap.xml`.

## Retour arrière (rollback)
- **Code** : Vercel → Deployments → choisissez le dernier déploiement sain → **… → Promote to Production** (instantané).
- **Base** : les migrations sont additives ; revenir au code précédent ne nécessite pas d'annuler une migration. En cas de problème grave,
  restaurez la sauvegarde Supabase (Database → Backups) **sur un nouveau projet**, vérifiez-la avec `npm run db:status`, puis changez
  `DATABASE_URL`. Ne supprimez jamais de table ni de déclencheur à la main. Les fichiers chiffrés restent lisibles tant que la même
  `FILE_ENCRYPTION_KEY` est conservée.
- **Tarifs** : publiez une nouvelle version reprenant l'ancienne grille (les demandes passées gardent leur prix figé).

## Mises à jour du code
Chaque `git push` sur `main` déclenche la CI GitHub (lint, typage, tests, E2E) puis un déploiement Vercel.
Les branches créent des déploiements *Preview* : ils utilisent **uniquement** les variables cochées *Preview* (base de pré-production)
et ne migrent jamais de base. Si une mise à jour contient une nouvelle migration (nouveau fichier dans `drizzle/`) :
sauvegarde → procédure de l'étape 5 bis sur la pré-production → recette → même procédure sur la production → déploiement.
