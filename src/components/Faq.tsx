export type FaqItem = { q: string; a: React.ReactNode };
export default function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="faq">
      {items.map((i) => (
        <details key={i.q}>
          <summary>{i.q}</summary>
          <p>{i.a}</p>
        </details>
      ))}
    </div>
  );
}

export const commonFaq = (zoneLabel = "Lyon (69001–69009) et Villeurbanne (69100)"): FaqItem[] => [
  { q: "Est-ce que je paie en ligne ?", a: "Non. Le site enregistre une demande de précommande / estimation sans paiement. Aucun prélèvement ni caution n'est encaissé sur le site. Le prix, la disponibilité et le créneau sont confirmés par notre équipe." },
  { q: "Ma demande vaut-elle réservation ?", a: "Non. Elle est enregistrée avec une référence et traitée par une personne. La location n'est ferme qu'après notre confirmation explicite du stock, du prix et du créneau." },
  { q: "En combien de temps livrez-vous ?", a: "Le créneau est convenu avec vous selon le stock et les tournées. Nous ne garantissons pas de délai fixe (pas de livraison « en 2 h » garantie)." },
  { q: "L'électricité est-elle incluse ?", a: "Non. La consommation électrique reste à la charge de l'utilisateur ou du donneur d'ordre." },
  { q: "La personne qui commande peut-elle être différente de celle qui reçoit le matériel ?", a: "Oui, c'est fréquent (propriétaire ou syndic qui commande, locataire ou gardien qui réceptionne). Le formulaire distingue les deux et le bon de remise les fait apparaître séparément." },
  { q: "Quelle est la zone desservie ?", a: `Les tarifs publiés concernent : ${zoneLabel}. Pour les autres communes, la demande est enregistrée et la livraison est chiffrée sur devis.` },
];
