# Checklist d'ouverture commerciale

L'application vérifie automatiquement les points marqués ⚙️ (encadré « Ouverture commerciale » de `/admin`
et `npm run check:launch`). Tant qu'un point ⚙️ manque, le site reste en **pré-production** (non indexé, bandeau).

## A. Éléments à nous fournir — réellement bloquants

| # | Élément | Où il sert | Variable / écran |
|---|---|---|---|
| 1 | Raison sociale ou nom de l'exploitant, forme juridique, capital | Mentions légales, bon PDF | ⚙️ `LEGAL_COMPANY_NAME`, `LEGAL_FORM` |
| 2 | SIREN / SIRET (+ RCS, n° TVA le cas échéant) | Mentions, bon | ⚙️ `LEGAL_SIREN`, `LEGAL_RCS`, `LEGAL_VAT_NUMBER` |
| 3 | Adresse du siège, email de contact, (téléphone) | Mentions, emails, bon | ⚙️ `LEGAL_ADDRESS`, `LEGAL_EMAIL`, `LEGAL_PHONE`, `PUBLIC_PHONE` |
| 4 | Directeur de la publication | Mentions légales | ⚙️ `LEGAL_PUBLICATION_DIRECTOR` |
| 5 | Nom / marque validés (INPI) et domaine acheté | Marque, emails, SEO | `BRAND_NAME`, `APP_URL` ⚙️ (HTTPS) |
| 6 | Adresse email dédiée de réception des demandes | Notifications | ⚙️ `TEAM_NOTIFICATION_EMAIL` |
| 7 | Comptes Vercel (Pro), Supabase, Resend (domaine vérifié) **neufs** | Hébergement, base, emails | ⚙️ `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` |
| 8 | Attestation d'assurance (RC pro / location, incendie, dommages aux tiers, transport, vol, casse) | Mentions, confiance | ⚙️ `LEGAL_INSURANCE` |
| 9 | CGL/CGV (B2B **et** B2C) et politique de confidentialité **relues par un juriste et l'assureur** (règle de décompte des jours, rétractation/exception consommateurs, médiateur, responsabilités, durées de conservation) | Pages légales | ⚙️ `LEGAL_TEXTS_VALIDATED=true` |
| 10 | Politique commerciale : confirmation de la grille, statut TVA (franchise ou non), zone, délais de réponse réellement tenus | Tarifs | `/admin/parametres` |
| 11 | Clé de chiffrement des pièces jointes générée et sauvegardée dans le coffre de l'entreprise | Scans, photos | ⚙️ `FILE_ENCRYPTION_KEY` |
| 12 | Matériel réellement acheté : marque, modèle, référence constructeur, puissance, **notice PDF**, n° de série s'ils existent | Catalogue, bon | `/admin/materiel` |

## B. Contrôles avant ouverture
- [ ] `npm run check:launch` : tout est ✔ (ou encadré vert dans `/admin`).
- [ ] Une demande test réelle : référence affichée, accusé reçu, alerte équipe reçue, visible dans l'admin.
- [ ] Parcours complet `RECETTE_PARCOURS.md` rejoué en pré-production (constats de remise et de reprise partielle/complète compris).
- [ ] Règle de décompte des jours choisie dans `/admin/parametres` **après** validation des CGL (sinon « à déterminer »).
- [ ] Rôles testés (compte commercial limité, désactivation qui coupe la session) ; panne email simulée puis renvoi.
- [ ] Bon PDF généré, ouvert sur ordinateur et téléphone, imprimé en A4 à 100 % et lisible ; bon signé scanné et déposé dans l'admin.
- [ ] Remise avec refus de signature et notice non remise testée : incident ouvert, visible au tableau de bord, résolu et tracé.
- [ ] Contrôle de réception enregistré pour chaque appareil ; procédure de contrôle après retour connue de l'équipe (aucun appareil reloué sans contrôle).
- [ ] Fermeture de la pré-production vérifiée en navigation privée (401 sans mot de passe).
- [ ] Modèle VARMA/Ingaro 244177 de démonstration **remplacé** par la vraie référence vérifiée (case « référence vérifiée »).
- [ ] Données de démonstration absentes de la base de production (ne jamais lancer `db:seed -- --demo` en production).
- [ ] `ADMIN_SETUP_TOKEN` supprimé ; comptes admin nominatifs, mots de passe forts, gestionnaire de mots de passe.
- [ ] Sauvegardes Supabase actives ; procédure de restauration **testée** une fois sur un projet séparé.
- [ ] Migrations appliquées par la procédure contrôlée (étape 5 bis) sur la pré-production PUIS la production ; `npm run db:status` « État conforme ✔ » ; opérations tracées ; `MIGRATE_ON_BUILD=false` ; variables *Preview* ≠ variables *Production*.
- [ ] `PREVIEW_PASSWORD` défini tant que le site public est en pré-production.
- [ ] Turnstile actif ; essai d'envoi depuis un téléphone.
- [ ] Responsable désigné pour traiter les demandes chaque jour ouvré (et remplaçant).
- [ ] Délai de réponse affiché **seulement** s'il est validé et mesuré (`operations.showResponseTargetPublicly`).
- [ ] Mentions sur les avis clients, photos, horaires : rien n'est affiché tant que ce n'est pas réel.
- [ ] Registre des traitements RGPD mis à jour (finalités, durées, sous-traitants : Vercel, Supabase, Resend, Cloudflare).
- [ ] Procédure ERP / écoles connue de l'équipe (validation du responsable du site avant toute utilisation).
- [ ] Responsable des demandes désigné + relance quotidienne (tuile « Demandes > 24 h sans contact » à zéro chaque soir).
- [ ] Le jour J seulement : `SITE_MODE=production`, `PREVIEW_PASSWORD` supprimé, encadré « Ouverture commerciale » entièrement vert, Search Console + sitemap.
- [ ] **Recette réelle signée** par le responsable de l'activité (voir `RECETTE_PARCOURS.md`). Aucune ouverture sans elle.

## C. Phase 2 (non bloquant au lancement)
Tarifs climatisation (quand gamme et fournisseurs validés), saisie des coûts réels par tournée, rôles séparés
(commercial / préparateur / exploitant déjà prévus), signature électronique, ventilation multi-sites en dossiers enfants.
