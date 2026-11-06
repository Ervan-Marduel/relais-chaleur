# Audit des 5 fichiers sources (6 novembre 2026)

Fichiers audités : `sources/index.html`, `sources/business-plan.md`, `sources/grille-tarifs.csv`,
`sources/plan-90-jours.md`, `sources/README.md` (+ `INSTRUCTIONS_A_CLAUDE.md`, `LISEZ_MOI.md`).

## Contradictions et erreurs relevées → décision appliquée

| # | Constat | Décision dans le code |
|---|---------|-----------------------|
| 1 | `index.html` : le formulaire **ne transmet rien** (texte à copier). | Remplacé par un assistant multi-étapes + API serveur + base PostgreSQL + notifications email avec file d'attente. |
| 2 | `index.html` ajoute automatiquement +45 € « express » au total estimé alors que la grille dit « uniquement si confirmé ». | L'express est une **option demandée**, jamais ajoutée au total estimé ; affichée « +45 € HT si confirmé ». Ajout possible seulement dans un devis admin. |
| 3 | `index.html` demande « nombre de radiateurs » d'abord. | L'assistant part de la **surface par pièce**, explique le calcul, puis laisse corriger la quantité. |
| 4 | `index.html` : « Lyon et Villeurbanne » ; CSV : « Livraison et reprise Lyon ». | Zone tarifée = codes postaux 69001–69009 + 69100 (Villeurbanne), **paramétrable**. Tout autre code postal → « sur devis ». |
| 5 | `README.md` cite `site/index.html` ; le fichier est dans `sources/`. | Sans impact (prototype remplacé). |
| 6 | Bandeau « PROTOTYPE » + case « aucune demande ne sera envoyée ». | Supprimés. Remplacés par « Demande de précommande / estimation sans paiement — sous réserve de confirmation ». Bandeau « pré-production » seulement tant que le mode production n'est pas débloqué. |
| 7 | Business plan : « le particulier n'est pas prioritaire » vs ordre de mission : particuliers acceptés. | B2C accepté, prix TTC mis en avant pour les particuliers ; positionnement éditorial B2B (page /professionnels). |
| 8 | TVA « indicative 20 % » mais statut fiscal du loueur inconnu (franchise possible). | `vatApplicable` + `vatRate` paramétrables ; mention « TVA à confirmer selon le statut du loueur ». |
| 9 | Durée : le prototype accepte un nombre de jours sans règle de décompte. | Le client déclare une **durée estimée** (ou « inconnue » → sur devis). Le bon affiche les **dates réelles** ; « durée facturable : à déterminer selon les conditions de location » tant qu'aucune règle n'est validée. |
| 10 | 9+ appareils : CSV « au-delà sur devis » ; prototype accepte 30 et calcule la location. | ≥ 9 appareils → **sur devis** (la logistique n'est pas tarifée), les paramètres de surface/quantité sont conservés. |
| 11 | « 1 radiateur 2 000 W ≈ 25 m² » présenté comme repère. | Règle configurable 80/100/120 W/m² selon isolation, facteur hauteur, calcul **par pièce**, avertissements ; jamais présenté comme garantie. |
| 12 | Phrase prototype « Matériel identifié, vérifié et livré sur rendez-vous » / « Chaleur de secours 2 000 W ». | Reformulé sans promesse : créneau confirmé par l'équipe, aucun délai garanti. |
| 13 | Le CA théorique (16 816 € HT / 55 commandes) n'est pas observé. | Non affiché sur le site. Les KPI réels sont mesurés en back-office. |
| 14 | Pas de téléphone, adresse, raison sociale, avis : rien à afficher. | Aucun téléphone/adresse/avis inventé ; champs `LEGAL_*` et `PUBLIC_PHONE` vides par défaut → non affichés / « à compléter ». |

## Données métier conservées (grille approuvée, HT, de test)
1–3 j : 39 € · 4–7 j : 59 € · 8–14 j : 88 € · 15–28 j : 129 € par appareil ;
livraison + reprise Lyon/Villeurbanne : 79 € (1–3 app.), 119 € (4–8 app.) ; express +45 € si confirmé ;
cas test 5 × 14 j = 559 € HT / 670,80 € TTC ; 3 × 7 j = 256 € HT.

## Valeurs manquantes → paramètres « à confirmer »
Identité légale, SIRET, adresse, téléphone, domaine, email de réception, statut TVA, règle de décompte des jours,
modèles et tarifs climatisation, notices et références matériel réelles, assurance, CGL validées.
