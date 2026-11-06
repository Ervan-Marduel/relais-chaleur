import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/** Données FIGÉES au moment de la génération (archivées avec le PDF). */
export type BonData = {
  brand: string;
  legal: { companyName: string | null; form: string | null; siren: string | null; address: string | null; email: string | null; phone: string | null };
  number: string;
  version: number;
  requestReference: string;
  generatedAt: string; // texte déjà formaté Europe/Paris
  customer: { kindLabel: string; isPro: boolean; companyName: string | null; siret: string | null; contactName: string; phone: string; email: string; address: string | null; customerReference: string | null };
  delivery: { recipientName: string; recipientPhone: string; address: string; floor: string | null; elevator: string | null; access: string | null; placeLabel: string };
  plannedDelivery: string | null; // date/heure confirmées, sinon null
  plannedPickup: string | null;
  service: "chauffage" | "climatisation";
  /** Une ligne par modèle réellement affecté. */
  equipmentLines: { brand: string; model: string; manufacturerRef: string | null; powerLabel: string | null; noticeVersion: string | null; quantity: number; codes: string[] }[];
  quantityPlanned: number;
  quantityOrdered: number | null;
  /** Justification obligatoire si quantité préparée ≠ quantité confirmée. */
  quantityJustification: string | null;
  units: { code: string; serial: string | null; lot: string | null; condition: string; model: string }[];
  allNewVerified: boolean;
  isErp: boolean;
};

const INLINE_UNITS_MAX = 12;
const C = { ink: "#13222c", muted: "#4a5961", line: "#7d8a90", soft: "#eef1f0", ember: "#b93d0c" };

const s = StyleSheet.create({
  page: { paddingTop: 18, paddingBottom: 26, paddingHorizontal: 24, fontFamily: "Helvetica", fontSize: 8, color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: C.ember, paddingBottom: 4, marginBottom: 5 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 12.5 },
  subtitle: { fontSize: 7.6, color: C.muted, marginTop: 2 },
  metaBox: { borderWidth: 1, borderColor: C.line, padding: 4, width: 175 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  b: { fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", gap: 6 },
  col: { flex: 1 },
  box: { borderWidth: 1, borderColor: C.line, padding: 4.5, marginBottom: 4 },
  boxTitle: { fontFamily: "Helvetica-Bold", fontSize: 8.5, backgroundColor: C.soft, marginHorizontal: -4.5, marginTop: -4.5, marginBottom: 3, paddingVertical: 2, paddingHorizontal: 4.5 },
  label: { color: C.muted },
  table: { borderWidth: 1, borderColor: C.line, marginBottom: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line },
  th: { fontFamily: "Helvetica-Bold", backgroundColor: C.soft, padding: 2.5 },
  td: { padding: 2.5 },
  fillLine: { borderBottomWidth: 0.7, borderBottomColor: C.line, height: 12, flex: 1, marginLeft: 3 },
  fillRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 1.5 },
  checkbox: { width: 8, height: 8, borderWidth: 0.9, borderColor: C.ink, marginRight: 3 },
  checkItem: { flexDirection: "row", alignItems: "center", marginRight: 12 },
  sigGrid: { flexDirection: "row", gap: 6, marginTop: 3 },
  sigBox: { flex: 1, borderWidth: 1, borderColor: C.line, padding: 4 },
  sigSpace: { height: 22, borderWidth: 0.5, borderColor: C.line, borderStyle: "dashed", marginTop: 2 },
  attest: { backgroundColor: "#f7f4ee", padding: 3.5, marginVertical: 2.5, fontSize: 8 },
  bullets: { fontSize: 7.6 },
  erp: { borderWidth: 1.2, borderColor: C.ember, padding: 3.5, marginTop: 3, fontSize: 7.8 },
  pageNo: { position: "absolute", bottom: 4, right: 24, fontSize: 6.9, color: C.muted },
  footer: { position: "absolute", bottom: 12, left: 26, right: 26, fontSize: 6.9, color: C.muted, flexDirection: "row", height: 24, justifyContent: "space-between" },
});

function Fill({ label, width, lines = 1 }: { label: string; width?: number; lines?: number }) {
  return (
    <View style={{ marginBottom: 1 }}>
      <View style={[s.fillRow, width ? { width } : {}]}>
        <Text style={s.label}>{label}</Text>
        <View style={s.fillLine} />
      </View>
      {Array.from({ length: lines - 1 }, (_, i) => <View key={i} style={[s.fillLine, { marginLeft: 0, marginBottom: 2.5 }]} />)}
    </View>
  );
}
function Box({ label }: { label: string }) {
  return <View style={s.checkItem}><View style={s.checkbox} /><Text>{label}</Text></View>;
}
function KV({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return <Text><Text style={s.label}>{k} : </Text>{v}</Text>;
}

export function BonDocument({ data: d }: { data: BonData }) {
  const annex = d.units.length > INLINE_UNITS_MAX;
  const legalLine = d.legal.companyName
    ? [d.legal.companyName, d.legal.form, d.legal.siren ? `SIREN/SIRET ${d.legal.siren}` : null, d.legal.address, d.legal.email, d.legal.phone].filter(Boolean).join(" · ")
    : "Identité légale de l'exploitant : à compléter avant mise en service commerciale (nom commercial provisoire).";
  const serviceLabel = d.service === "chauffage" ? "Chauffage d'appoint (radiateur électrique)" : "Climatisation mobile";
  const lots = [...new Set(d.units.map((u) => u.lot).filter(Boolean))] as string[];

  return (
    <Document title={`Bon ${d.number} — ${d.requestReference}`} author={d.brand} subject="Bon de remise et de reprise" language="fr-FR">
      <Page size="A4" style={s.page}>
        <View style={s.footer} fixed>
          <Text style={{ flex: 1 }}>Ce bon constate la remise, la notice, les rappels de sécurité, l&apos;état, les quantités et la restitution. La signature du réceptionnaire prouve la réception ; elle ne lui transfère pas les obligations de paiement du donneur d&apos;ordre. Responsabilités respectives : voir conditions de location.</Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${d.number} · page ${pageNumber}/${totalPages}`} />
        <View style={s.header}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={s.title}>{d.brand.toUpperCase()} — BON DE REMISE ET DE REPRISE</Text>
            <Text style={s.subtitle}>{legalLine}</Text>
          </View>
          <View style={s.metaBox}>
            <View style={s.metaRow}><Text style={s.label}>N° de bon</Text><Text style={s.b}>{d.number}{d.version > 1 ? ` (v${d.version})` : ""}</Text></View>
            <View style={s.metaRow}><Text style={s.label}>Réf. précommande</Text><Text style={s.b}>{d.requestReference}</Text></View>
            <View style={s.metaRow}><Text style={s.label}>Généré le</Text><Text>{d.generatedAt}</Text></View>
          </View>
        </View>

        <View style={s.row}>
          <View style={[s.box, s.col]}>
            <Text style={s.boxTitle}>CLIENT / DONNEUR D&apos;ORDRE</Text>
            <Text style={s.b}>{d.customer.isPro && d.customer.companyName ? d.customer.companyName : d.customer.contactName}</Text>
            <KV k="Type" v={d.customer.kindLabel} />
            {d.customer.isPro ? <KV k="SIRET" v={d.customer.siret ?? "non communiqué"} /> : null}
            {d.customer.isPro ? <KV k="Contact" v={d.customer.contactName} /> : null}
            <KV k="Tél." v={d.customer.phone} />
            <KV k="Email" v={d.customer.email} />
            <KV k="Adresse" v={d.customer.address} />
            <KV k="Réf. client" v={d.customer.customerReference} />
          </View>
          <View style={[s.box, s.col]}>
            <Text style={s.boxTitle}>LIEU DE LIVRAISON ET RÉCEPTIONNAIRE</Text>
            <Text style={s.b}>{d.delivery.address}</Text>
            <KV k="Lieu" v={d.delivery.placeLabel} />
            <KV k="Étage / ascenseur" v={[d.delivery.floor, d.delivery.elevator ? `ascenseur : ${d.delivery.elevator}` : null].filter(Boolean).join(" · ") || null} />
            <KV k="Accès" v={d.delivery.access} />
            <KV k="Réceptionnaire" v={`${d.delivery.recipientName} · ${d.delivery.recipientPhone}`} />
            <KV k="Livraison prévue" v={d.plannedDelivery ?? "créneau à confirmer"} />
            <KV k="Reprise prévue" v={d.plannedPickup ?? "à convenir"} />
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>MATÉRIEL PRÉPARÉ</Text>
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, { width: "24%" }]}>Type</Text>
              <Text style={[s.th, { width: "36%" }]}>Marque / modèle / réf. constructeur</Text>
              <Text style={[s.th, { width: "14%" }]}>Puissance</Text>
              <Text style={[s.th, { width: "10%" }]}>Qté prévue</Text>
              <Text style={[s.th, { width: "16%" }]}>Notice</Text>
            </View>
            {d.equipmentLines.map((l, i) => (
              <View key={i} style={[s.tr, i === d.equipmentLines.length - 1 ? { borderBottomWidth: 0 } : {}]}>
                <Text style={[s.td, { width: "24%" }]}>{serviceLabel}</Text>
                <Text style={[s.td, { width: "36%" }]}>{[l.brand, l.model, l.manufacturerRef].filter(Boolean).join(" / ")}</Text>
                <Text style={[s.td, { width: "14%" }]}>{l.powerLabel ?? "—"}</Text>
                <Text style={[s.td, { width: "10%" }, s.b]}>{l.quantity}</Text>
                <Text style={[s.td, { width: "16%" }]}>{l.noticeVersion ?? "notice du fabricant"}</Text>
              </View>
            ))}
          </View>
          {d.quantityOrdered != null && (
            <Text style={s.bullets}>
              <Text style={s.label}>Quantité confirmée : </Text>{d.quantityOrdered} · <Text style={s.label}>préparée sur ce bon : </Text><Text style={s.b}>{d.quantityPlanned}</Text>
              {d.quantityOrdered > d.quantityPlanned ? <Text> · <Text style={s.b}>reste à livrer : {d.quantityOrdered - d.quantityPlanned}</Text> (commande partiellement exécutée)</Text> : null}
              {d.quantityJustification ? <Text> — <Text style={s.b}>écart justifié :</Text> {d.quantityJustification}</Text> : null}
              <Text> · La quantité EFFECTIVEMENT remise est celle inscrite ci-dessous à la livraison.</Text>
            </Text>
          )}
          <Text>
            <Text style={s.label}>Références d&apos;inventaire internes préparées : </Text>
            {annex ? `${d.units.length} appareils — liste complète en annexe` : d.equipmentLines.length > 1
              ? d.equipmentLines.map((l) => `${l.model} : ${l.codes.join(", ")}`).join(" ; ")
              : d.units.map((u) => u.code + (u.serial ? ` (n° série ${u.serial})` : "")).join(", ")}
          </Text>
          {lots.length > 0 && <Text style={s.bullets}><Text style={s.label}>Lot(s) fournisseur : </Text>{lots.join(", ")} — un numéro de lot est commun à plusieurs appareils et ne les identifie pas individuellement.</Text>}
          <Text style={s.bullets}><Text style={s.label}>État déclaré à la préparation : </Text>{d.allNewVerified ? "neuf (contrôlé avant départ)" : d.units.every((u) => u.condition === "neuf" || u.condition === "bon") ? "bon état (contrôlé au retour précédent) — à constater sur place" : "à constater sur place"}</Text>
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>À LA LIVRAISON — à compléter et signer sur place</Text>
          <View style={s.row}>
            <View style={s.col}><Fill label="Date réelle de remise :" /></View>
            <View style={{ width: 110 }}><Fill label="Heure :" /></View>
            <View style={s.col}><Fill label="Quantité effectivement livrée :" /></View>
          </View>
          <Fill label="Références réellement remises (si différentes de la préparation) :" />
          <Fill label="État visuel / réserves :" lines={2} />
          <View style={[s.row, { alignItems: "center", marginBottom: 2 }]}>
            <Text style={s.label}>Notice(s) complète(s) du constructeur remise(s) : </Text>
            <Box label="oui" /><Box label="non" />
          </View>
          <Text style={s.attest}>
            « Je reconnais avoir reçu le matériel indiqué, ainsi que sa notice complète, comprenant les instructions d&apos;utilisation et mises en garde du fabricant. J&apos;ai été invité à les lire avant toute mise en service et je m&apos;engage à les respecter. »
          </Text>
          <Text style={[s.b, { fontSize: 7.8 }]}>Rappels de sécurité (les avertissements exacts de la notice du constructeur prévalent) :</Text>
          <Text style={s.bullets}>
            • Surface chaude : risque de brûlure — surveiller les enfants et les personnes vulnérables. • Ne pas couvrir l&apos;appareil ; respecter les distances aux matériaux combustibles indiquées par la notice.
            {"\n"}• Pas d&apos;installation improvisée ; pas de multiprise ni de rallonge sauf autorisation expresse conforme à la notice. • Ne pas utiliser si le cordon ou la prise est endommagé.
            {"\n"}• Respecter la puissance disponible et les circuits : chaque appareil {d.equipmentLines.length === 1 && d.equipmentLines[0].powerLabel ? `(${d.equipmentLines[0].powerLabel}) ` : ""}consomme une intensité importante ; plusieurs prises peuvent partager un circuit. La remise ne vaut ni installation, ni autorisation électrique, ni mise en service.
          </Text>
          <Text style={[s.erp, d.isErp ? { backgroundColor: "#fbe9df" } : {}]}>
            <Text style={s.b}>{d.isErp ? "SITE ERP / ÉCOLE — " : "ERP / école : "}</Text>
            Aucune utilisation avant validation de l&apos;admissibilité des appareils et de leur implantation par le responsable du site conformément aux règles applicables. Ce bon ne vaut pas autorisation de mise en service.
          </Text>
          <Text style={[s.bullets, { marginTop: 2 }]}><Text style={s.b}>Refus de signer : </Text>la personne remettant le matériel inscrit « Refus de signer », la date, l&apos;heure, son nom et signe (et un témoin si possible). Aucun appareil ne doit être laissé sans sa notice.</Text>
          <View style={s.sigGrid}>
            <View style={s.sigBox}>
              <Text style={s.b}>Le réceptionnaire</Text>
              <Text style={s.label}>Mention manuscrite « Lu et approuvé » :</Text>
              <View style={[s.sigSpace, { height: 13 }]} />
              <Fill label="Nom :" />
              <View style={s.row}><View style={s.col}><Fill label="Date :" /></View><View style={s.col}><Fill label="Heure :" /></View></View>
              <Text style={s.label}>Signature :</Text>
              <View style={s.sigSpace} />
            </View>
            <View style={s.sigBox}>
              <Text style={s.b}>La personne remettant le matériel</Text>
              <Fill label="Nom :" />
              <Text style={s.label}>Signature :</Text>
              <View style={[s.sigSpace, { height: 49 }]} />
            </View>
          </View>
        </View>

        <View style={s.box} wrap={false}>
          <Text style={s.boxTitle}>À LA REPRISE — à compléter et signer au retour (même bon)</Text>
          <View style={s.row}>
            <View style={s.col}><Fill label="Date réelle de reprise :" /></View>
            <View style={{ width: 110 }}><Fill label="Heure :" /></View>
            <View style={s.col}><Fill label="Nombre réellement récupéré :" /></View>
          </View>
          <Fill label="Références d'inventaire récupérées (si nécessaire) :" />
          <View style={[s.row, { alignItems: "center", marginBottom: 2 }]}>
            <Text style={s.label}>État général : </Text>
            <Box label="conforme" /><Box label="dégradé" /><Box label="incomplet" />
          </View>
          <Fill label="Observations et réserves :" lines={2} />
          <Text style={s.bullets}>
            <Text style={s.label}>Durée constatée : </Text>du ______ (remise réelle) au ______ (reprise réelle). Jours de location facturables : à déterminer selon les conditions de location acceptées.
          </Text>
          <View style={s.sigGrid}>
            <View style={s.sigBox}>
              <Text style={s.b}>Le réceptionnaire présent sur place</Text>
              <Fill label="Nom :" />
              <Text style={s.label}>Signature :</Text>
              <View style={[s.sigSpace, { height: 20 }]} />
            </View>
            <View style={s.sigBox}>
              <Text style={s.b}>La personne qui reprend le matériel</Text>
              <Fill label="Nom :" />
              <Text style={s.label}>Signature :</Text>
              <View style={[s.sigSpace, { height: 20 }]} />
            </View>
          </View>
        </View>

      </Page>

      {annex && (
        <Page size="A4" style={s.page}>
          <Text style={[s.title, { marginBottom: 6 }]}>ANNEXE — INVENTAIRE DES APPAREILS · {d.number} · {d.requestReference}</Text>
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, { width: "15%" }]}>Réf. interne</Text>
              <Text style={[s.th, { width: "30%" }]}>Modèle</Text>
              <Text style={[s.th, { width: "20%" }]}>N° série constructeur</Text>
              <Text style={[s.th, { width: "15%" }]}>Lot</Text>
              <Text style={[s.th, { width: "10%" }]}>Remis</Text>
              <Text style={[s.th, { width: "10%" }]}>Repris</Text>
            </View>
            {d.units.map((u) => (
              <View style={s.tr} key={u.code} wrap={false}>
                <Text style={[s.td, { width: "15%" }, s.b]}>{u.code}</Text>
                <Text style={[s.td, { width: "30%" }]}>{u.model}</Text>
                <Text style={[s.td, { width: "20%" }]}>{u.serial ?? "—"}</Text>
                <Text style={[s.td, { width: "15%" }]}>{u.lot ?? "—"}</Text>
                <View style={[s.td, { width: "10%" }]}><View style={s.checkbox} /></View>
                <View style={[s.td, { width: "10%" }]}><View style={s.checkbox} /></View>
              </View>
            ))}
          </View>
          <View style={s.sigGrid}>
            <View style={s.sigBox}><Text style={s.b}>Paraphe du réceptionnaire (livraison)</Text><View style={s.sigSpace} /></View>
            <View style={s.sigBox}><Text style={s.b}>Paraphe du réceptionnaire (reprise)</Text><View style={s.sigSpace} /></View>
          </View>
          <View style={s.footer} fixed>
            <Text style={{ flex: 1 }}>Annexe au bon de remise et de reprise {d.number}.</Text>
          </View>
          <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${d.number} · page ${pageNumber}/${totalPages}`} />
        </Page>
      )}
    </Document>
  );
}
