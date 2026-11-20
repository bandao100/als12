// Exemple d'intégration du widget de billetterie dans une application React (16.8 et plus).
//
//   <BilletterieTicketSecure organisateur="mon-organisation-1a2b" couleur="#e4572e" />
//
// Le domaine de votre application doit être déclaré dans l'espace organisateur → Intégration.
import { useEffect } from "react";

// Adresse de VOTRE plateforme Ticket Secure Pro.
const PLATEFORME = "https://billets.exemple.com";

function chargerScript() {
  if (document.querySelector("script[data-tsp-billetterie]")) return;
  const script = document.createElement("script");
  script.src = `${PLATEFORME}/static/embed/billetterie.js`;
  script.defer = true;
  script.dataset.tspBilletterie = "1";
  document.head.appendChild(script);
}

export default function BilletterieTicketSecure({ organisateur, evenement, couleur, titre, filtres }) {
  useEffect(chargerScript, []);
  // Le widget lit ses attributs au montage : la « key » le recrée si l'un d'eux change.
  const key = [organisateur, evenement, couleur, titre, filtres].join("|");
  return (
    <tsp-billetterie
      key={key}
      serveur={PLATEFORME}
      organisateur={organisateur}
      evenement={evenement}
      couleur={couleur}
      titre={titre}
      filtres={filtres}
    />
  );
}

// TypeScript : déclarez l'élément une fois dans votre projet, par exemple dans src/types.d.ts :
//
//   declare namespace JSX {
//     interface IntrinsicElements {
//       "tsp-billetterie": { [attribut: string]: unknown };
//     }
//   }
