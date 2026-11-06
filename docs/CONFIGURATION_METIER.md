# Configuration métier

## Où sont les paramètres ?
- **Source de vérité : la base** (table `pricing_versions`), modifiable dans **`/admin/parametres`** (rôle admin).
  Chaque publication crée une **version immuable** ; la précédente est désactivée mais conservée.
  Chaque demande fige la version utilisée (`requests.pricing_version_id` + `estimate_snapshot`) : changer la grille
  ne modifie jamais une demande ou un devis existant (un déclencheur PostgreSQL l'interdit).
- **Valeurs initiales : [`config/business.ts`](../config/business.ts)**, utilisées uniquement pour créer la version 1
  sur une base vierge (`npm run db:seed`).

Tous les montants sont en **centimes HT** (8800 = 88,00 €) ; la TVA en points de base (2000 = 20 %).

## Paramètres disponibles

| Bloc | Clés | Effet |
|---|---|---|
| TVA | `vatApplicable`, `vatRateBp`, `vatNote` | Calcul TTC ; `vatApplicable=false` si franchise (TTC = HT) |
| Location chauffage | `heating.rentalTiers[]` (`minDays`, `maxDays`, `unitPriceHtCents`) | Paliers par appareil. Durée hors paliers ou inconnue → **sur devis** |
| Express | `heating.expressSurchargeHtCents` | Affiché « si confirmé », **jamais** ajouté au total estimé |
| Puissance | `heating.sizing.wattsPerM2.{bonne,moyenne,faible}` | 80/100/120 W/m² par défaut |
| | `unknownInsulationAs` | Hypothèse prudente pour « je ne sais pas » (moyenne) |
| | `referenceHeightM`, `maxHeightM` | Facteur hauteur ; au-delà de `maxHeightM` → étude/devis |
| | `maxRoomSurfaceM2`, `maxTotalSurfaceM2`, `maxRooms` | Seuils « estimation uniquement, étude du site nécessaire » |
| | `maxUnitsPerDwellingAuto` | Au-delà (appartement/maison) → revue humaine obligatoire |
| | `maxSelectableUnits`, `unitPowerW`, `nominalVoltage` | Bornes de l'assistant ; 2 000 W / 230 V ⇒ ≈ 8,7 A affichés |
| Climatisation | `cooling.pricingEnabled` | `false` = pré-demande sur devis (aucun prix). Phase 2 |
| | `cooling.sizing.*` | Fourchette indicative W froid / BTU (exposition, isolation, occupants) |
| Zones | `zones[]` (`postalCodes`, `logistics[]` : `minUnits`, `maxUnits`, `priceHtCents`) | Forfait **livraison ET reprise**. Code postal absent ou quantité hors paliers → **sur devis** |
| Exploitation | `operations.vehicles[]`, `responseTargetHours`, `showResponseTargetPublicly` | Informations internes ; délai affiché seulement si validé et mesuré |
| Décompte des jours | `rental.dayCountRule` : `null` (défaut), `calendar_inclusive`, `started_24h_periods` | À choisir **après validation des CGL**. Tant que `null`, la durée constatée affiche « à déterminer ». La règle est celle de la version acceptée par le client |
| Juridique | `legal.termsVersion`, `legal.privacyVersion` | Version des textes enregistrée avec chaque consentement |

## Règle de calcul chauffage (documentée dans `src/lib/domain/heating.ts`)
Pour chaque pièce : `ceil(surface × W/m² × max(1, hauteur / 2,5) / 2000)`, minimum 1 appareil par pièce occupée.
Si seule la surface totale est connue, elle est répartie également entre les pièces (avertissement de précision).
ERP / école, hauteur atypique, grandes surfaces, trop d'appareils dans un logement → **aucune acceptation automatique**.

## Tests de contrôle de la grille par défaut
5 radiateurs × 14 jours à Lyon = 5 × 88 + 119 = **559 € HT / 670,80 € TTC** ; 3 × 7 jours = 3 × 59 + 79 = **256 € HT**
(`tests/unit/domain.test.ts`). Si vous changez la grille, ces deux tests échoueront volontairement : mettez-les à jour.
