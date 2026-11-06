export default function SafetyNotice({ unitPowerW = 2000, voltage = 230 }: { unitPowerW?: number; voltage?: number }) {
  const amps = (Math.round((unitPowerW / voltage) * 10) / 10).toLocaleString("fr-FR");
  return (
    <div className="notice warn" role="note">
      <p><strong>Sécurité électrique — à lire avant de commander</strong></p>
      <ul>
        <li>Un radiateur de {unitPowerW.toLocaleString("fr-FR")} W consomme environ {amps} A sous {voltage} V. Plusieurs appareils = puissance totale = quantité × {unitPowerW / 1000} kW.</li>
        <li>Plusieurs prises peuvent dépendre du même circuit : la capacité électrique du logement ou du bâtiment doit être confirmée par une personne compétente.</li>
        <li>Pas de multiprise ni de rallonge, sauf autorisation expresse et conforme à la notice du fabricant.</li>
        <li>Surface chaude : risque de brûlure, surveillance des enfants et des personnes vulnérables ; ne pas couvrir ; respecter les distances aux matériaux combustibles indiquées par la notice.</li>
        <li>La notice du constructeur prime. Aucune garantie de température n&apos;est donnée ; la livraison ne vaut pas installation ni mise en service.</li>
      </ul>
    </div>
  );
}
