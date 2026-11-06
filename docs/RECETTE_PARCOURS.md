# Parcours de recette détaillé — de la précommande au parc de nouveau disponible

Ce parcours est **automatisé** (`tests/e2e/recette.spec.ts`, exécuté sur un build de production) et doit être
**rejoué à la main** sur la pré-production réelle (Vercel + Supabase + Resend neufs) avant toute ouverture.
Captures : `docs/captures/recette-*.png`.

| # | Étape | Action | Résultat attendu (vérifié par le test automatique) |
|---|---|---|---|
| 1 | Précommande particulier | `/demande` : 60 m², 3 pièces, bonne isolation, maison, 10 jours, 69007 ; réceptionnaire différent | Recommandation 3 appareils ; référence `RC-AAAA-NNNNNN` affichée après enregistrement ; accusé + alerte équipe |
| 2 | Appel | Fiche → « Appels et notes » → type Appel | Note tracée, 1er contact horodaté |
| 3 | Qualification + devis | Statut « À qualifier » → devis prérempli → « Devis à confirmer » | Devis v1 figé (immuable) |
| 4 | Planning + confirmation | Date de livraison, reprise prévue, **quantité confirmée** (3), **modèle retenu** ; 5 cases de contrôle → « Confirmer après contrôle » | Statut « Confirmée » (admin uniquement) |
| 5 | Affectation de 3 appareils distincts | Cocher RC-006, RC-007, RC-008 | Les appareils « à contrôler » / hors service ne sont pas proposés ; refus si autre modèle non justifié, doublon, dépassement de quantité |
| 6 | Bon PDF | « En préparation » → « Générer le bon » | PDF A4 1 page, donneur d'ordre ≠ réceptionnaire, RC-006, RC-007, RC-008 ; écart de quantité impossible sans justification imprimée |
| 7 | **Remise partielle + refus de signature** | Constat de remise : 2 appareils sur 3 (écart justifié), notice remise, « le réceptionnaire REFUSE de signer » | Sans motif d'incident : refusé. Avec motif + consignes : remise « avec INCIDENT », incident visible au tableau de bord, badge « exécution partielle 2/3 », « scan du bon signé non déposé » |
| 8 | Remise du 3e appareil | Constat conforme : notice remise, bon signé, scan PDF joint | Remise « conforme » ; plus d'exécution partielle |
| 9 | Preuve et résolution | Déposer le scan du 1er bon (contresigné), clôturer l'incident (admin, motif) | Scan téléchargeable (déchiffré côté serveur, accès journalisé), incident « résolu », tracé |
| 10 | Retard de reprise | Reprise prévue dépassée | Alerte « Reprises en retard » ; appareils toujours indisponibles |
| 11 | **Reprise partielle** | 2 sur 3 (RC-007 dégradé), bon signé, scan | 1 appareil encore chez le client ; **RC-006 et RC-007 « à contrôler » — non louables, même RC-006 d'apparence conforme** |
| 12 | **Contrôle technique** | Matériel → Contrôle technique : RC-006 (5 points OK, « Bon ») ; RC-007 (anomalies, « Hors service ») | RC-006 disponible ; RC-007 non louable ; historique des contrôles ; événement « controle » distinct de la « reprise » |
| 13 | Reprise complète + clôture | Constat pour RC-008, contrôle de RC-008, statut « Clôturée », note « DEMANDE DE TEST » | « Reprise effectuée » puis « Clôturée » ; RC-008 disponible seulement après son contrôle. **Pas d'annulation** : une demande livrée ne peut pas être annulée |
| 14 | Annulation (seconde demande) | Nouvelle demande confirmée, 1 appareil affecté **non remis**, statut « Annulée » avec motif | Réservation annulée et tracée ; l'appareil redevient affectable sans contrôle (jamais sorti) ; une tentative d'annuler la 1re demande est refusée |

## Cas limites couverts par les tests d'intégration (`tests/integration/stock.test.ts`)
- **Contrôle technique** : reprise conforme ≠ louable ; contrôle approuvé ⇒ louable ; contrôle incomplet refusé ; rôle commercial refusé ; « hors service » exige des anomalies ; « neuf » interdit après location ; la base refuse tout passage à « bon » sans inspection et toute création d'appareil hors « à contrôler ».
- **Preuve de remise** : « conforme » refusé par la base sans signature ; notice par modèle obligatoire ; incident obligatoire (motif + consignes) en cas de notice non remise, refus ou absence de signature, à la remise comme à la reprise ; résolution réservée à l'admin puis immuable ; scan chiffré (aucun clair en base) et restitué à l'identique ; faux PDF refusé.
- Retard de reprise de **7 jours** + commande concurrente : RC-001 refusé (« chez le client — RC-… ») puis accepté après le constat de reprise.
- **Concurrence** : deux affectations simultanées du même appareil → une seule réussit (index unique en base).
- **Prolongation** : la reprise prévue est répercutée dans la même transaction sur les affectations et tracée (`prolongation`, avant/après).
- Appareil **remis** : ni annulation, ni « libération », ni suppression, ni annulation/clôture de la demande — refusés par l'application **et** par des déclencheurs PostgreSQL.
- Lot de **3 dont 1 hors service** : refus, aucune ligne insérée. **Deux modèles** : refus sans justification ; bon multi-lignes avec justification. **Quantité inférieure** : bon refusé sans justification ; justification imprimée sinon. **Identifiants répétés** : refus.
- Remise datée dans le futur, reprise antérieure à la remise, écart de quantité non justifié, photo invalide : refusés.
- Migration 0004 appliquée à des données de l'ancien schéma : conversions explicites et tracées (`allocation_events.kind = migration`), données d'origine conservées.

## À faire en pré-production réelle (non automatisable ici)
Prérequis : migrations appliquées par la procédure contrôlée (`npm run db:status` → « État conforme ✔ », opération tracée).
0. Vérifier en navigation privée que la pré-production renvoie 401 sans mot de passe.
1. Rejouer les étapes 1 à 14 avec de vrais emails (réception de l'accusé et de l'alerte sur les vraies boîtes).
2. Imprimer le bon en A4 à 100 %, le faire signer, le scanner (téléphone) et déposer le scan ; saisir les constats depuis le papier.
3. Ouvrir le PDF et une photo de constat sur un téléphone.
4. Tester les rôles : créer un compte « commercial » (`/admin/comptes`), vérifier qu'il ne peut ni confirmer ni annuler une réservation ; le désactiver et vérifier que sa session est coupée.
5. Simuler une panne email (clé Resend erronée sur la pré-production) : la demande reste enregistrée, l'échec apparaît dans `/admin/notifications`, le renvoi fonctionne après correction.
6. Restaurer une sauvegarde Supabase sur un projet séparé et vérifier qu'elle contient la demande test.
