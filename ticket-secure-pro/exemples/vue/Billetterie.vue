<!--
  Exemple d'intégration du widget de billetterie dans une application Vue 3.

  1. Dans main.js, déclarez l'élément comme composant web :
       app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith("tsp-");
     (avec Vite : option vue({ template: { compilerOptions: { isCustomElement: … } } }) dans vite.config.js)
  2. Utilisez : <Billetterie organisateur="mon-organisation-1a2b" couleur="#e4572e" />
  3. Déclarez le domaine de votre application dans l'espace organisateur → Intégration.
-->
<script setup>
import { onMounted } from "vue";

const props = defineProps({
  organisateur: String,
  evenement: String,
  couleur: String,
  titre: String,
  filtres: String,
});

// Adresse de VOTRE plateforme Ticket Secure Pro.
const PLATEFORME = "https://billets.exemple.com";

onMounted(() => {
  if (document.querySelector("script[data-tsp-billetterie]")) return;
  const script = document.createElement("script");
  script.src = `${PLATEFORME}/static/embed/billetterie.js`;
  script.defer = true;
  script.dataset.tspBilletterie = "1";
  document.head.appendChild(script);
});
</script>

<template>
  <tsp-billetterie
    :serveur="PLATEFORME"
    :organisateur="props.organisateur"
    :evenement="props.evenement"
    :couleur="props.couleur"
    :titre="props.titre"
    :filtres="props.filtres"
  />
</template>
