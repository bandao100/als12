/* Colombe 3 — Suivi budgétaire.
 * Application hors ligne : fonctionne dans la WebView Android (objet AndroidPont)
 * ou dans un navigateur (stockage local du navigateur). */
(function () {
  'use strict';

  var CLE = 'colombe3-donnees';
  var pont = window.AndroidPont || null;
  var MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var MODES = ['Espèces', 'Virement', 'Mobile Money', 'Chèque', 'Autre'];
  var STATUTS = {
    solde: { libelle: 'Soldé', classe: 'ok' },
    encours: { libelle: 'En cours', classe: 'cours' },
    attente: { libelle: 'En attente', classe: 'attente' }
  };
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
    'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août',
    'sept.', 'oct.', 'nov.', 'déc.'];
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  // Données d'origine (issues du classeur Excel) ; projet vide si le fichier est absent.
  var INITIALES = window.DONNEES_INITIALES || {
    projet: { nom: 'Mon chantier', sousTitre: 'Suivi budgétaire' }, lots: [], postes: [], paiements: []
  };

  var etat;          // données enregistrées (projet, lots, postes, paiements)
  var calc = null;   // totaux recalculés après chaque modification
  var ui = { onglet: 'accueil', statut: 'tous', lot: '', recherche: '', hMois: '', hLot: '', hRecherche: '' };
  var pile = [];     // pages superposées ouvertes
  var dialogue = null;

  // ------------------------------------------------------------ Outils

  function $(sel, racine) { return (racine || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function fmt(n) { return nf.format(Math.round(n || 0)); }
  function fcfa(n) { return fmt(n) + ' F CFA'; }
  function pct(x) { return (Math.round((x || 0) * 1000) / 10).toLocaleString('fr-FR') + ' %'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function dateFr(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function dateLongue(iso) {
    var p = iso.split('-').map(Number);
    var j = JOURS[new Date(p[0], p[1] - 1, p[2]).getDay()];
    return j.charAt(0).toUpperCase() + j.slice(1) + ' ' + p[2] + ' ' + MOIS[p[1] - 1] + ' ' + p[0];
  }
  function moisCourt(ym) {
    var p = ym.split('-');
    return MOIS_COURTS[+p[1] - 1] + ' ' + p[0];
  }

  function uid(prefixe) { return prefixe + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function lireMontant(v) { return parseInt(String(v || '').replace(/[^\d]/g, ''), 10) || 0; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function icone(nom, classe) {
    return '<svg class="ico' + (classe ? ' ' + classe : '') + '" aria-hidden="true"><use href="#i-' + nom + '"/></svg>';
  }
  function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }

  // ------------------------------------------------------------ Données

  function valide(d) {
    return !!d && typeof d === 'object' && Array.isArray(d.lots) && Array.isArray(d.postes) && Array.isArray(d.paiements);
  }

  function analyser(brut) {
    if (!brut) return null;
    try {
      var d = JSON.parse(brut);
      return valide(d) ? d : null;
    } catch (e) {
      return null;
    }
  }

  function normaliser(d) {
    d.version = 1;
    d.projet = d.projet || {};
    d.projet.nom = String(d.projet.nom || 'Colombe 3');
    d.projet.sousTitre = String(d.projet.sousTitre || '');
    d.lots = d.lots.filter(function (l) { return l && l.id; }).map(function (l) {
      return { id: String(l.id), nom: String(l.nom || '') };
    });
    d.postes = d.postes.filter(function (p) { return p && p.id; }).map(function (p) {
      return {
        id: String(p.id), lot: String(p.lot || ''), nom: String(p.nom || 'Sans titre'),
        date: String(p.date || ''), prestataire: String(p.prestataire || ''),
        budget: Math.max(0, Math.round(Number(p.budget) || 0)), obs: String(p.obs || '')
      };
    });
    d.paiements = d.paiements.filter(function (v) { return v && v.id; }).map(function (v) {
      return {
        id: String(v.id), posteId: String(v.posteId || ''), date: String(v.date || ''),
        montant: Math.round(Number(v.montant) || 0), mode: String(v.mode || ''),
        prestataire: String(v.prestataire || ''), notes: String(v.notes || '')
      };
    });
    d.postes.forEach(function (p) {
      if (!d.lots.some(function (l) { return l.id === p.lot; })) d.lots.push({ id: p.lot, nom: 'Lot ' + p.lot });
    });
    return d;
  }

  function charger() {
    var d = null;
    try { d = analyser(pont ? pont.lireDonnees() : localStorage.getItem(CLE)); } catch (e) { d = null; }
    if (!d && pont) {
      try { d = analyser(pont.lireSecours()) || analyser(localStorage.getItem(CLE)); } catch (e) { d = null; }
    }
    var premiere = !d;
    etat = normaliser(d || copie(INITIALES));
    if (premiere) sauver(true);
  }

  function sauver(sansDate) {
    if (!sansDate) etat.modifieLe = new Date().toISOString();
    calc = null;
    var json = JSON.stringify(etat);
    var ok = true;
    if (pont) {
      try { ok = pont.ecrireDonnees(json) !== false; } catch (e) { ok = false; }
    }
    try { localStorage.setItem(CLE, json); } catch (e) { if (!pont) ok = false; }
    if (!ok) toast('Les données n\'ont pas pu être enregistrées sur le téléphone.', { type: 'erreur' });
  }

  function poste(id) { return etat.postes.find(function (p) { return p.id === id; }) || null; }
  function paiement(id) { return etat.paiements.find(function (v) { return v.id === id; }) || null; }
  function lot(id) { return etat.lots.find(function (l) { return l.id === id; }) || null; }
  function lotLibelle(id) {
    var l = lot(id);
    return 'Lot ' + id + (l && l.nom ? ' — ' + l.nom : '');
  }

  function calculer() {
    var parPoste = {}, parLot = {};
    var total = { budget: 0, paye: 0, nb: 0, solde: 0, encours: 0, attente: 0 };
    etat.lots.forEach(function (l) { parLot[l.id] = { budget: 0, paye: 0, nb: 0, soldes: 0 }; });
    etat.postes.forEach(function (p) { parPoste[p.id] = { paye: 0, nb: 0, dernier: '' }; });
    etat.paiements.forEach(function (v) {
      var s = parPoste[v.posteId];
      if (!s) return;
      s.paye += v.montant;
      s.nb++;
      if (v.date > s.dernier) s.dernier = v.date;
    });
    etat.postes.forEach(function (p) {
      var s = parPoste[p.id];
      s.reste = p.budget - s.paye;
      s.statut = (p.budget > 0 || s.paye > 0) && s.reste <= 0 ? 'solde' : (s.paye > 0 ? 'encours' : 'attente');
      s.taux = p.budget > 0 ? Math.min(s.paye / p.budget, 1) : (s.paye > 0 ? 1 : 0);
      var l = parLot[p.lot] || (parLot[p.lot] = { budget: 0, paye: 0, nb: 0, soldes: 0 });
      l.budget += p.budget;
      l.paye += s.paye;
      l.nb++;
      if (s.statut === 'solde') l.soldes++;
      total.budget += p.budget;
      total.paye += s.paye;
      total.nb++;
      total[s.statut]++;
    });
    Object.keys(parLot).forEach(function (k) {
      var l = parLot[k];
      l.reste = l.budget - l.paye;
      l.taux = l.budget > 0 ? l.paye / l.budget : 0;
    });
    total.reste = total.budget - total.paye;
    total.taux = total.budget > 0 ? total.paye / total.budget : 0;
    return { parPoste: parPoste, parLot: parLot, total: total };
  }

  function k() { return calc || (calc = calculer()); }

  function prioritaires(n) {
    var s = k().parPoste;
    return etat.postes.filter(function (p) { return s[p.id].reste > 0; })
      .sort(function (a, b) { return s[b.id].reste - s[a.id].reste; })
      .slice(0, n);
  }

  /** Paiements triés du plus récent au plus ancien (à date égale : dernier saisi d'abord). */
  function paiementsTries(liste) {
    var ordre = {};
    etat.paiements.forEach(function (v, i) { ordre[v.id] = i; });
    return liste.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return ordre[b.id] - ordre[a.id];
    });
  }

  function prestataires() {
    var vus = {};
    etat.postes.concat(etat.paiements).forEach(function (x) {
      var n = (x.prestataire || '').trim();
      if (n && !vus[norm(n)]) vus[norm(n)] = n;
    });
    return Object.keys(vus).map(function (c) { return vus[c]; }).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  }

  // ------------------------------------------------------------ Morceaux d'interface

  function jauge(taux, classe) {
    var v = Math.round(Math.max(0, Math.min(1, taux || 0)) * 100);
    return '<span class="jauge ' + (classe || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      v + '"><span style="width:' + v + '%"></span></span>';
  }

  function badge(statut) {
    var s = STATUTS[statut];
    return '<span class="badge ' + s.classe + '">' + s.libelle + '</span>';
  }

  function lignePoste(p, rang) {
    var s = k().parPoste[p.id];
    var sous = [p.prestataire, s.nb ? pluriel(s.nb, 'paiement') : 'aucun paiement'].filter(Boolean).join(' · ');
    if (rang) sous = 'Lot ' + p.lot + (p.prestataire ? ' · ' + p.prestataire : '');
    var droite = s.statut === 'solde'
      ? '<span class="ligne-montant nombre">' + fmt(p.budget) + '</span>' + badge('solde')
      : '<span class="ligne-montant nombre cours">' + fmt(s.reste) + '</span><span class="discret nombre">' + (rang ? 'sur ' : 'reste sur ') + fmt(p.budget) + '</span>';
    return '<button class="ligne" data-action="voir-poste" data-id="' + esc(p.id) + '">' +
      (rang ? '<span class="rang">' + rang + '</span>' : '') +
      '<span class="ligne-corps"><span class="ligne-titre">' + esc(p.nom) + '</span>' +
      '<span class="ligne-sous">' + esc(sous) + '</span>' + (rang ? '' : jauge(s.taux, STATUTS[s.statut].classe)) + '</span>' +
      '<span class="ligne-droite">' + droite + '</span></button>';
  }

  function lignePaiement(v, o) {
    o = o || {};
    var p = poste(v.posteId);
    var titre = o.sansPoste ? dateFr(v.date) : (p ? p.nom : 'Poste supprimé');
    var sous = [o.sansPoste || !p ? '' : 'Lot ' + p.lot, v.prestataire, v.mode].filter(Boolean).join(' · ');
    return '<button class="ligne" data-action="modifier-paiement" data-id="' + esc(v.id) + '">' +
      '<span class="ligne-corps"><span class="ligne-titre">' + esc(titre) + '</span>' +
      (sous ? '<span class="ligne-sous">' + esc(sous) + '</span>' : '') +
      (v.notes ? '<span class="ligne-notes">' + esc(v.notes) + '</span>' : '') + '</span>' +
      '<span class="ligne-droite"><span class="ligne-montant nombre">' + fmt(v.montant) + '</span>' +
      (o.avecDate ? '<span class="discret">' + dateFr(v.date) + '</span>' : '') + '</span></button>';
  }

  function puce(filtre, valeur, libelle, actif) {
    return '<button class="puce" data-action="filtre" data-filtre="' + filtre + '" data-valeur="' + esc(valeur) +
      '" aria-pressed="' + (actif ? 'true' : 'false') + '">' + esc(libelle) + '</button>';
  }

  function optionsLots(choisi, avecTous) {
    return (avecTous ? '<option value="">Tous les lots</option>' : '') + etat.lots.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === choisi ? ' selected' : '') + '>' + esc(lotLibelle(l.id)) + '</option>';
    }).join('');
  }

  function champModes(choisi) {
    return '<fieldset class="champ"><legend>Mode de paiement</legend><div class="choix">' +
      MODES.map(function (m) {
        return '<label><input type="radio" name="mode" value="' + esc(m) + '"' + (m === choisi ? ' checked' : '') +
          '><span>' + esc(m) + '</span></label>';
      }).join('') + '</div></fieldset>';
  }

  function listePrestataires() {
    return '<datalist id="liste-prestataires">' + prestataires().map(function (n) {
      return '<option value="' + esc(n) + '">';
    }).join('') + '</datalist>';
  }

  function valeurRadio(form, nom) {
    var c = form.querySelector('input[name="' + nom + '"]:checked');
    return c ? c.value : '';
  }

  function brancherMontant(input, apres) {
    input.addEventListener('input', function () {
      var n = lireMontant(input.value);
      input.value = n ? fmt(n) : '';
      if (apres) apres();
    });
  }

  // ------------------------------------------------------------ Vues principales

  function vueAccueil() {
    var c = k(), t = c.total;
    var html = '<section class="bandeau" aria-label="Synthèse">' +
      '<p class="bandeau-libelle">Reste à décaisser</p>' +
      '<p class="bandeau-montant nombre">' + fmt(t.reste) + ' <small>F CFA</small></p>' + jauge(t.taux) +
      '<div class="bandeau-pied"><span>Avancement financier</span><b class="nombre">' + pct(t.taux) + '</b></div></section>';

    html += '<div class="chiffres" style="grid-template-columns:1fr 1fr">' +
      '<div class="carte chiffre"><p class="chiffre-libelle">Budget total</p><p class="chiffre-valeur nombre">' + fmt(t.budget) + ' <small>F</small></p></div>' +
      '<div class="carte chiffre"><p class="chiffre-libelle">Montant payé</p><p class="chiffre-valeur nombre ok">' + fmt(t.paye) + ' <small>F</small></p></div></div>' +
      '<button class="carte ligne" style="margin-top:10px" data-action="voir-statut" data-valeur="tous">' +
      '<span class="pastille-ico">' + icone('liste') + '</span><span class="ligne-corps"><span class="ligne-titre">' + pluriel(t.nb, 'poste') + '</span>' +
      '<span class="ligne-sous">' + t.solde + ' soldé' + (t.solde > 1 ? 's' : '') + ' · ' + t.encours + ' en cours · ' + t.attente + ' en attente</span></span>' +
      icone('chevron', 'petite') + '</button>';

    if (rappelSauvegarde()) {
      html += '<div class="carte carte-pad avertissement" style="margin-top:12px">' + icone('alerte') +
        '<div>Pensez à exporter une sauvegarde : les données ne sont enregistrées que sur ce téléphone.' +
        '<div class="boutons" style="margin-top:10px"><button class="btn" data-action="export-sauvegarde">' + icone('telecharger') +
        ' Sauvegarder maintenant</button></div></div></div>';
    }

    var budgets = etat.lots.map(function (l) { return (c.parLot[l.id] || {}).budget || 0; });
    var max = Math.max.apply(null, budgets.concat([1]));
    html += '<section class="section"><h2 class="section-titre"><span>Budget vs payé par lot</span></h2><div class="carte">' +
      etat.lots.map(function (l) {
        var s = c.parLot[l.id];
        if (!s || !s.nb) return '';
        return '<button class="lot" data-action="voir-lot" data-lot="' + esc(l.id) + '">' +
          '<span class="lot-entete"><span class="lot-nom"><b>' + esc(l.id) + '</b>' + esc(l.nom) + '</span>' +
          '<span class="lot-taux nombre ' + (s.reste <= 0 ? 'ok' : '') + '">' + pct(s.taux) + '</span></span>' +
          '<span class="barres"><span class="barre-budget" style="width:' + Math.max(4, s.budget / max * 100) + '%">' +
          '<span style="width:' + Math.min(100, s.taux * 100) + '%"></span></span></span>' +
          '<span class="lot-detail"><span class="nombre">' + fmt(s.paye) + ' / ' + fmt(s.budget) + '</span>' +
          '<span>' + (s.reste > 0 ? 'Reste <b class="nombre cours">' + fmt(s.reste) + '</b>' : '<b class="ok">Soldé</b>') + '</span></span></button>';
      }).join('') +
      '<p class="legende"><span><i style="background:var(--bleu)"></i>Payé</span><span><i style="background:var(--ciel-pale)"></i>Reste du budget</span><span>Longueur = budget du lot</span></p>' +
      '</div></section>';

    var prio = prioritaires(5);
    html += '<section class="section"><h2 class="section-titre"><span>Postes prioritaires à régler</span>' +
      (t.encours + t.attente > 5 ? '<button data-action="voir-statut" data-valeur="apayer">Tout voir (' + (t.encours + t.attente) + ')</button>' : '') + '</h2>' +
      (prio.length ? '<div class="carte">' + prio.map(function (p, i) { return lignePoste(p, i + 1); }).join('') + '</div>'
        : '<div class="carte vide">' + icone('coche') + '<p>Tous les postes sont soldés.</p></div>') + '</section>';

    var derniers = paiementsTries(etat.paiements).slice(0, 5);
    html += '<section class="section"><h2 class="section-titre"><span>Derniers paiements</span>' +
      (etat.paiements.length > 5 ? '<button data-action="onglet" data-onglet="historique">Historique</button>' : '') + '</h2>' +
      (derniers.length ? '<div class="carte">' + derniers.map(function (v) { return lignePaiement(v, { avecDate: true }); }).join('') + '</div>'
        : '<div class="carte vide">Aucun paiement enregistré.</div>') + '</section>';

    html += '<p class="pied-page">' + pluriel(etat.paiements.length, 'paiement') + ' enregistré' + (etat.paiements.length > 1 ? 's' : '') +
      (etat.modifieLe ? ' · modifié le ' + dateFr(etat.modifieLe.slice(0, 10)) : '') + '</p>';
    return html;
  }

  function rappelSauvegarde() {
    if (!etat.modifieLe) return false;
    if (etat.sauvegardeLe && etat.sauvegardeLe >= etat.modifieLe) return false;
    var depuis = etat.sauvegardeLe ? Date.now() - Date.parse(etat.sauvegardeLe) : Infinity;
    return depuis > 7 * 864e5;
  }

  function vuePostes() {
    var t = k().total;
    return '<label class="recherche">' + icone('recherche') +
      '<input type="search" data-input="recherche" enterkeyhint="search" placeholder="Rechercher un poste, un prestataire…" aria-label="Rechercher un poste" value="' + esc(ui.recherche) + '"></label>' +
      '<div class="puces" role="group" aria-label="Filtrer par statut">' +
      puce('statut', 'tous', 'Tous (' + t.nb + ')', ui.statut === 'tous') +
      puce('statut', 'apayer', 'À payer (' + (t.encours + t.attente) + ')', ui.statut === 'apayer') +
      puce('statut', 'solde', 'Soldés (' + t.solde + ')', ui.statut === 'solde') + '</div>' +
      '<select class="selection-lot" data-input="lot" aria-label="Filtrer par lot">' + optionsLots(ui.lot, true) + '</select>' +
      '<div id="liste-postes">' + listePostes() + '</div>';
  }

  function listePostes() {
    var c = k(), q = norm(ui.recherche);
    var trouves = etat.postes.filter(function (p) {
      var s = c.parPoste[p.id];
      if (ui.statut === 'apayer' && s.statut === 'solde') return false;
      if (ui.statut === 'solde' && s.statut !== 'solde') return false;
      if (ui.lot && p.lot !== ui.lot) return false;
      return !q || norm(p.nom + ' ' + p.prestataire + ' ' + p.obs).indexOf(q) >= 0;
    });
    if (!trouves.length) {
      return '<div class="vide">' + icone('recherche') + '<p>Aucun poste ne correspond.</p></div>';
    }
    var reste = trouves.reduce(function (a, p) { return a + Math.max(0, c.parPoste[p.id].reste); }, 0);
    var html = '<p class="resume-filtre">' + pluriel(trouves.length, 'poste') + ' · reste à payer <b class="nombre">' + fcfa(reste) + '</b></p>';
    etat.lots.forEach(function (l) {
      var groupe = trouves.filter(function (p) { return p.lot === l.id; });
      if (!groupe.length) return;
      var r = groupe.reduce(function (a, p) { return a + Math.max(0, c.parPoste[p.id].reste); }, 0);
      html += '<section class="groupe"><h2 class="groupe-titre"><span>' + esc(lotLibelle(l.id)) + '</span>' +
        '<span class="nombre">' + (r > 0 ? 'reste ' + fmt(r) + ' F' : 'soldé') + '</span></h2>' +
        '<div class="carte">' + groupe.map(function (p) { return lignePoste(p); }).join('') + '</div></section>';
    });
    return html;
  }

  function vueHistorique() {
    var mois = [];
    etat.paiements.forEach(function (v) {
      var m = v.date.slice(0, 7);
      if (m && mois.indexOf(m) < 0) mois.push(m);
    });
    mois.sort().reverse();
    return '<label class="recherche">' + icone('recherche') +
      '<input type="search" data-input="h-recherche" enterkeyhint="search" placeholder="Rechercher (poste, prestataire, note…)" aria-label="Rechercher un paiement" value="' + esc(ui.hRecherche) + '"></label>' +
      '<div class="puces" role="group" aria-label="Filtrer par mois">' + puce('mois', '', 'Tous les mois', !ui.hMois) +
      mois.map(function (m) { return puce('mois', m, moisCourt(m), ui.hMois === m); }).join('') + '</div>' +
      '<select class="selection-lot" data-input="h-lot" aria-label="Filtrer par lot">' + optionsLots(ui.hLot, true) + '</select>' +
      '<div id="liste-historique">' + listeHistorique() + '</div>';
  }

  function listeHistorique() {
    var q = norm(ui.hRecherche);
    var liste = paiementsTries(etat.paiements.filter(function (v) {
      var p = poste(v.posteId);
      if (ui.hMois && v.date.slice(0, 7) !== ui.hMois) return false;
      if (ui.hLot && (!p || p.lot !== ui.hLot)) return false;
      return !q || norm((p ? p.nom : '') + ' ' + v.prestataire + ' ' + v.notes + ' ' + v.mode).indexOf(q) >= 0;
    }));
    if (!liste.length) return '<div class="vide">' + icone('horloge') + '<p>Aucun paiement ne correspond.</p></div>';
    var total = liste.reduce(function (a, v) { return a + v.montant; }, 0);
    var html = '<p class="resume-filtre">' + pluriel(liste.length, 'paiement') + ' · total <b class="nombre">' + fcfa(total) + '</b></p>';
    var i = 0;
    while (i < liste.length) {
      var date = liste[i].date, jour = [];
      while (i < liste.length && liste[i].date === date) jour.push(liste[i++]);
      var somme = jour.reduce(function (a, v) { return a + v.montant; }, 0);
      html += '<section class="groupe"><h2 class="groupe-titre"><span>' + (date ? esc(dateLongue(date)) : 'Sans date') + '</span>' +
        '<span class="nombre">' + fmt(somme) + ' F</span></h2><div class="carte">' +
        jour.map(function (v) { return lignePaiement(v); }).join('') + '</div></section>';
    }
    return html;
  }

  function vuePlus() {
    var version = '';
    try { version = pont ? pont.version() : ''; } catch (e) { version = ''; }
    function entree(action, ico, titre, sous) {
      return '<button class="ligne" data-action="' + action + '"><span class="pastille-ico">' + icone(ico) + '</span>' +
        '<span class="ligne-corps"><span class="ligne-titre">' + titre + '</span><span class="ligne-sous">' + sous + '</span></span>' +
        icone('chevron', 'petite') + '</button>';
    }
    return '<section><h2 class="section-titre"><span>Rapports</span></h2><div class="carte">' +
      entree('prestataires', 'personne', 'Prestataires', 'Montants versés et restes par prestataire') +
      entree('partager-point', 'partage', 'Partager le point budgétaire', 'Résumé à envoyer par WhatsApp, SMS, e-mail…') +
      '</div></section>' +
      '<section class="section"><h2 class="section-titre"><span>Exporter et sauvegarder</span></h2><div class="carte">' +
      entree('export-excel', 'tableur', 'Exporter en Excel (.xlsx)', 'Tableau de bord, suivi détaillé et historique') +
      entree('export-sauvegarde', 'telecharger', 'Exporter une sauvegarde', 'Fichier .json à garder en lieu sûr (Drive, WhatsApp…)') +
      entree('import-sauvegarde', 'importer', 'Restaurer une sauvegarde', 'Remplace les données par celles d\'un fichier .json') +
      '</div><p class="discret" style="margin:8px 4px 0">Les données sont enregistrées uniquement sur ce téléphone. ' +
      'Exportez régulièrement une sauvegarde : elle permet de tout retrouver sur un autre téléphone ou après une réinstallation.</p></section>' +
      '<section class="section"><h2 class="section-titre"><span>Paramètres</span></h2><div class="carte">' +
      entree('projet', 'crayon', 'Nom du projet', esc(etat.projet.nom) + (etat.projet.sousTitre ? ' · ' + esc(etat.projet.sousTitre) : '')) +
      entree('lots', 'dossier', 'Lots de travaux', pluriel(etat.lots.length, 'lot')) +
      entree('reinitialiser', 'annuler', 'Revenir aux données du classeur Excel', 'Efface les saisies faites dans l\'application') +
      '</div></section>' +
      '<p class="pied-page">Colombe 3 · Suivi budgétaire' + (version ? ' · version ' + esc(version) : '') + '<br>' +
      pluriel(etat.postes.length, 'poste') + ' · ' + pluriel(etat.paiements.length, 'paiement') +
      (etat.sauvegardeLe ? '<br>Dernière sauvegarde exportée le ' + dateFr(etat.sauvegardeLe.slice(0, 10)) : '') + '</p>';
  }

  var ONGLETS = {
    accueil: {
      titre: function () { return etat.projet.nom; },
      sous: function () { return etat.projet.sousTitre; },
      vue: vueAccueil,
      actions: '<button class="bouton-icone" data-action="partager-point" aria-label="Partager le point budgétaire">' + icone('partage') + '</button>'
    },
    postes: {
      titre: function () { return 'Postes de travaux'; },
      sous: function () { return etat.projet.nom + ' · ' + pluriel(etat.postes.length, 'poste'); },
      vue: vuePostes,
      actions: '<button class="bouton-icone" data-action="nouveau-poste" aria-label="Nouveau poste">' + icone('plus') + '</button>'
    },
    historique: {
      titre: function () { return 'Historique'; },
      sous: function () { return pluriel(etat.paiements.length, 'paiement') + ' · ' + fcfa(k().total.paye); },
      vue: vueHistorique,
      actions: ''
    },
    plus: {
      titre: function () { return 'Plus'; },
      sous: function () { return etat.projet.nom; },
      vue: vuePlus,
      actions: ''
    }
  };

  function rendre() {
    var o = ONGLETS[ui.onglet];
    $('#titre').textContent = o.titre();
    $('#sous-titre').textContent = o.sous();
    $('#actions-haut').innerHTML = o.actions;
    $('#vue').innerHTML = o.vue();
    Array.prototype.forEach.call(document.querySelectorAll('.onglet'), function (b) {
      if (b.dataset.onglet === ui.onglet) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function allerA(onglet) {
    var change = ui.onglet !== onglet;
    ui.onglet = onglet;
    rendre();
    if (change) window.scrollTo(0, 0);
  }

  function toutRafraichir() {
    calc = null;
    rendre();
    pile.slice().forEach(function (f) {
      if (!f.rendu) return;
      var html = f.rendu();
      if (html === null) {
        fermerFeuille(f);
        return;
      }
      var corps = f.el.querySelector('.feuille-corps');
      var y = corps.scrollTop;
      corps.innerHTML = html;
      corps.scrollTop = y;
    });
  }

  // ------------------------------------------------------------ Pages superposées, dialogues, notifications

  function ouvrirFeuille(o) {
    var el = document.createElement('section');
    el.className = 'feuille';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', o.titre);
    el.innerHTML = '<header class="feuille-entete"><button class="bouton-icone" data-action="fermer-feuille" aria-label="Retour">' +
      icone('retour') + '</button><h2>' + esc(o.titre) + '</h2><div class="actions-haut">' + (o.actions || '') + '</div></header>' +
      '<div class="feuille-corps"></div>';
    var f = { el: el, rendu: o.rendu || null };
    el.querySelector('.feuille-corps').innerHTML = o.rendu ? o.rendu() : o.corps;
    pile.push(f);
    document.body.appendChild(el);
    document.body.classList.add('avec-feuille');
    void el.offsetWidth;
    el.classList.add('ouverte');
    if (o.apres) o.apres(el, f);
    return f;
  }

  function fermerFeuille(f) {
    f = f || pile[pile.length - 1];
    var i = pile.indexOf(f);
    if (i < 0) return false;
    pile.splice(i, 1);
    if (!pile.length) document.body.classList.remove('avec-feuille');
    if (document.activeElement && f.el.contains(document.activeElement)) document.activeElement.blur();
    f.el.classList.remove('ouverte');
    setTimeout(function () { f.el.remove(); }, 240);
    return true;
  }

  /** Boîte de dialogue ; renvoie une promesse résolue avec la valeur du bouton choisi (null si fermée). */
  function demander(o) {
    var boutons = o.boutons || [
      { libelle: 'Annuler', valeur: false },
      { libelle: o.ok || 'Confirmer', valeur: true, classe: o.danger ? 'danger' : 'principal' }
    ];
    return new Promise(function (resoudre) {
      var voile = document.createElement('div');
      voile.className = 'voile';
      voile.innerHTML = '<div class="dialogue" role="alertdialog" aria-modal="true" aria-labelledby="dialogue-titre">' +
        '<h3 id="dialogue-titre">' + esc(o.titre) + '</h3>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') +
        '<div class="boutons">' + boutons.map(function (b, i) {
          return '<button class="btn ' + (b.classe || '') + '" data-i="' + i + '">' + esc(b.libelle) + '</button>';
        }).join('') + '</div></div>';
      function fin(valeur) {
        voile.remove();
        dialogue = null;
        resoudre(valeur);
      }
      voile.addEventListener('click', function (e) {
        if (e.target === voile) return fin(null);
        var b = e.target.closest('[data-i]');
        if (b) fin(boutons[+b.dataset.i].valeur);
      });
      dialogue = { fermer: function () { fin(null); } };
      document.body.appendChild(voile);
      var dernier = voile.querySelectorAll('.btn');
      dernier[dernier.length - 1].focus();
    });
  }

  var minuteurToast = null;
  function toast(message, o) {
    o = o || {};
    var zone = $('#toast');
    zone.innerHTML = '<div class="toast ' + (o.type || '') + '"><span>' + esc(message) + '</span>' +
      (o.action ? '<button type="button">' + esc(o.action.libelle) + '</button>' : '') + '</div>';
    if (o.action) {
      zone.querySelector('button').addEventListener('click', function () {
        zone.innerHTML = '';
        o.action.fn();
      });
    }
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(function () { zone.innerHTML = ''; }, o.action ? 7000 : 3500);
  }

  /** Applique une modification, l'enregistre et propose de l'annuler. */
  function avecAnnulation(message, operation) {
    var avant = JSON.stringify(etat);
    operation();
    sauver();
    toutRafraichir();
    toast(message, {
      action: {
        libelle: 'Annuler',
        fn: function () {
          etat = normaliser(JSON.parse(avant));
          sauver();
          toutRafraichir();
          toast('Modification annulée');
        }
      }
    });
  }

  window.retourArriere = function () {
    if (dialogue) { dialogue.fermer(); return true; }
    if (pile.length) { fermerFeuille(); return true; }
    if (ui.onglet !== 'accueil') { allerA('accueil'); return true; }
    return false;
  };

  window.appliquerMarges = function (haut, bas) {
    var s = document.documentElement.style;
    s.setProperty('--haut', (+haut || 0) + 'px');
    s.setProperty('--bas', (+bas || 0) + 'px');
  };

  // ------------------------------------------------------------ Détail d'un poste

  function ouvrirPoste(id) {
    ouvrirFeuille({
      titre: 'Détail du poste',
      actions: '<button class="bouton-icone" data-action="modifier-poste" data-id="' + esc(id) + '" aria-label="Modifier le poste">' + icone('crayon') + '</button>',
      rendu: function () { return htmlPoste(id); }
    });
  }

  function htmlPoste(id) {
    var p = poste(id);
    if (!p) return null;
    var s = k().parPoste[id];
    var liste = paiementsTries(etat.paiements.filter(function (v) { return v.posteId === id; }));
    var eid = esc(id);
    return '<section class="carte detail-tete"><h3>' + esc(p.nom) + '</h3>' +
      '<div class="detail-meta">' + badge(s.statut) + '<span>' + esc(lotLibelle(p.lot)) + '</span>' +
      (p.prestataire ? '<span>' + icone('personne', 'petite') + ' ' + esc(p.prestataire) + '</span>' : '') + '</div>' +
      '<div class="grille-montants"><div><span>Budget</span><b class="nombre">' + fmt(p.budget) + '</b></div>' +
      '<div><span>Payé</span><b class="nombre ok">' + fmt(s.paye) + '</b></div>' +
      '<div><span>Reste</span><b class="nombre ' + (s.reste > 0 ? 'cours' : (s.reste < 0 ? 'alerte' : '')) + '">' + fmt(s.reste) + '</b></div></div>' +
      jauge(s.taux, STATUTS[s.statut].classe) +
      '<div class="lot-detail" style="margin-top:6px"><span>' + pct(s.taux) + ' réglé</span><span>Date : ' + dateFr(p.date) + '</span></div>' +
      (s.reste < 0 ? '<p class="alerte" style="font-size:14px;margin-top:8px">Les paiements dépassent le budget de ' + fcfa(-s.reste) + '.</p>' : '') +
      '<div class="boutons">' +
      (s.reste > 0
        ? '<button class="btn principal" data-action="payer" data-id="' + eid + '">' + icone('billet') + ' Enregistrer un paiement</button>' +
          '<button class="btn succes" data-action="solder" data-id="' + eid + '">' + icone('coche') + ' Solder · ' + fmt(s.reste) + ' F</button>'
        : '<button class="btn" data-action="payer" data-id="' + eid + '">' + icone('billet') + ' Ajouter un paiement</button>') +
      '</div></section>' +
      (p.obs ? '<section class="section"><h2 class="section-titre"><span>Observations</span></h2><div class="carte carte-pad observations">' + esc(p.obs) + '</div></section>' : '') +
      '<section class="section"><h2 class="section-titre"><span>Paiements (' + liste.length + ')</span></h2>' +
      (liste.length ? '<div class="carte">' + liste.map(function (v) { return lignePaiement(v, { sansPoste: true }); }).join('') + '</div>'
        : '<div class="carte vide">Aucun paiement pour ce poste.</div>') + '</section>' +
      '<div class="boutons" style="margin-top:22px"><button class="btn" data-action="modifier-poste" data-id="' + eid + '">' + icone('crayon') + ' Modifier</button>' +
      '<button class="btn danger" data-action="supprimer-poste" data-id="' + eid + '">' + icone('poubelle') + ' Supprimer</button></div>';
  }

  // ------------------------------------------------------------ Saisie d'un paiement

  function ouvrirPaiement(o) {
    var v = o.paiementId ? paiement(o.paiementId) : null;
    var choix = { posteId: v ? v.posteId : (o.posteId || '') };
    var ajuster = true;
    var montant = v ? v.montant : 0;
    if (!v && o.solder && poste(choix.posteId)) montant = Math.max(0, k().parPoste[choix.posteId].reste);
    var titre = v ? 'Modifier le paiement' : (o.solder ? 'Solder le poste' : 'Nouveau paiement');

    var corps = '<form class="formulaire" novalidate>' +
      '<div class="champ"><span>Poste de travaux</span><button type="button" class="selecteur" data-role="choisir"></button>' +
      '<span class="erreur-champ" data-erreur="poste" hidden>Choisissez le poste concerné.</span></div>' +
      '<label class="champ"><span>Montant versé (F CFA)</span><input class="montant" name="montant" inputmode="numeric" autocomplete="off" placeholder="0" value="' +
      (montant ? fmt(montant) : '') + '"><span class="erreur-champ" data-erreur="montant" hidden>Indiquez le montant versé.</span></label>' +
      '<div class="raccourcis" data-role="raccourcis"></div>' +
      '<label class="champ"><span>Date du paiement</span><input type="date" name="date" value="' + esc(v ? v.date : aujourdhui()) + '"></label>' +
      champModes(v ? v.mode : '') +
      '<label class="champ"><span>Prestataire / bénéficiaire</span><input name="prestataire" list="liste-prestataires" autocomplete="off" placeholder="Facultatif" value="' +
      esc(v ? v.prestataire : '') + '"></label>' + listePrestataires() +
      '<label class="champ"><span>Notes</span><textarea name="notes" rows="2" placeholder="Ex. : Acompte n°2, reçu n°…">' + esc(v ? v.notes : '') + '</textarea></label>' +
      '<div data-role="depassement"></div><div class="apercu" data-role="apercu"></div>' +
      '<div class="boutons"><button type="submit" class="btn principal">' + icone('coche') + (v ? ' Enregistrer les modifications' : ' Enregistrer le paiement') + '</button></div>' +
      (v ? '<div class="boutons"><button type="button" class="btn danger" data-role="supprimer">' + icone('poubelle') + ' Supprimer ce paiement</button></div>' : '') +
      '</form>';

    ouvrirFeuille({
      titre: titre,
      corps: corps,
      apres: function (el) {
        var form = el.querySelector('form');
        var prestaModifie = !!(v && v.prestataire);

        function situation() {
          var p = poste(choix.posteId);
          if (!p) return null;
          var deja = k().parPoste[p.id].paye - (v && v.posteId === p.id ? v.montant : 0);
          return { p: p, deja: deja, reste: p.budget - deja, m: lireMontant(form.montant.value) };
        }

        function maj() {
          var x = situation();
          var bouton = form.querySelector('[data-role="choisir"]');
          bouton.innerHTML = x
            ? '<span class="selecteur-texte"><b>' + esc(x.p.nom) + '</b><small>' + esc(lotLibelle(x.p.lot)) + ' · reste ' + fmt(x.reste) + ' F</small></span>' + icone('chevron', 'petite')
            : '<span class="selecteur-texte"><b>Choisir un poste…</b><small>Appuyez pour rechercher</small></span>' + icone('chevron', 'petite');
          form.querySelector('[data-role="raccourcis"]').innerHTML = x && x.reste > 0
            ? '<button type="button" class="raccourci" data-montant="' + x.reste + '">Solde restant : ' + fmt(x.reste) + ' F</button>' : '';
          var zoneDep = form.querySelector('[data-role="depassement"]');
          var zoneApercu = form.querySelector('[data-role="apercu"]');
          if (!x || !x.m) {
            zoneDep.innerHTML = '';
            zoneApercu.innerHTML = '';
            return;
          }
          var depassement = x.deja + x.m - x.p.budget;
          zoneDep.innerHTML = depassement > 0
            ? '<div class="avertissement">' + icone('alerte') + '<div>Ce montant dépasse le budget du poste de <b class="nombre">' + fmt(depassement) + ' F</b>.' +
              '<label class="case" style="margin-top:8px"><input type="checkbox" data-role="ajuster"' + (ajuster ? ' checked' : '') +
              '> Porter le budget du poste à ' + fmt(x.deja + x.m) + ' F</label></div></div>'
            : '';
          var budget = depassement > 0 && ajuster ? x.deja + x.m : x.p.budget;
          var reste = budget - x.deja - x.m;
          zoneApercu.innerHTML = 'Après ce paiement : payé <b class="nombre">' + fmt(x.deja + x.m) + '</b> sur <b class="nombre">' + fmt(budget) +
            '</b> F<br>Reste à payer : <b class="nombre">' + fmt(reste) + ' F</b> ' + badge(reste <= 0 ? 'solde' : 'encours');
        }

        function choisi(id) {
          choix.posteId = id;
          var p = poste(id);
          if (p && !prestaModifie) form.prestataire.value = p.prestataire;
          form.querySelector('[data-erreur="poste"]').hidden = true;
          maj();
        }

        form.querySelector('[data-role="choisir"]').addEventListener('click', function () { choisirPoste(choisi); });
        form.prestataire.addEventListener('input', function () { prestaModifie = true; });
        brancherMontant(form.montant, function () {
          form.querySelector('[data-erreur="montant"]').hidden = true;
          maj();
        });
        form.addEventListener('click', function (e) {
          var r = e.target.closest('[data-montant]');
          if (r) {
            form.montant.value = fmt(+r.dataset.montant);
            form.querySelector('[data-erreur="montant"]').hidden = true;
            maj();
          }
        });
        form.addEventListener('change', function (e) {
          if (e.target.dataset && e.target.dataset.role === 'ajuster') {
            ajuster = e.target.checked;
            maj();
          }
        });
        var supprimer = form.querySelector('[data-role="supprimer"]');
        if (supprimer) {
          supprimer.addEventListener('click', function () {
            demander({ titre: 'Supprimer ce paiement ?', message: fcfa(v.montant) + ' du ' + dateFr(v.date), ok: 'Supprimer', danger: true })
              .then(function (ok) {
                if (!ok) return;
                fermerFeuille();
                avecAnnulation('Paiement supprimé', function () {
                  etat.paiements = etat.paiements.filter(function (x) { return x.id !== v.id; });
                });
              });
          });
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var x = situation();
          form.querySelector('[data-erreur="poste"]').hidden = !!x;
          form.querySelector('[data-erreur="montant"]').hidden = !!(x ? x.m : lireMontant(form.montant.value));
          if (!x || !x.m) return;
          var donnees = {
            posteId: x.p.id,
            montant: x.m,
            date: form.date.value || aujourdhui(),
            mode: valeurRadio(form, 'mode'),
            prestataire: form.prestataire.value.trim(),
            notes: form.notes.value.trim()
          };
          if (x.deja + x.m > x.p.budget && ajuster) x.p.budget = x.deja + x.m;
          if (v) Object.assign(v, donnees);
          else etat.paiements.push(Object.assign({ id: uid('v') }, donnees));
          sauver();
          fermerFeuille();
          toutRafraichir();
          var s = k().parPoste[x.p.id];
          toast(s.statut === 'solde' ? 'Paiement enregistré · poste soldé ✓' : 'Paiement enregistré · reste ' + fcfa(s.reste));
        });

        if (!v && poste(choix.posteId)) form.prestataire.value = poste(choix.posteId).prestataire;
        maj();
        if (!choix.posteId) setTimeout(function () { choisirPoste(choisi); }, 260);
      }
    });
  }

  function choisirPoste(surChoix) {
    var q = '', soldes = false;
    ouvrirFeuille({
      titre: 'Choisir un poste',
      corps: '<label class="recherche">' + icone('recherche') +
        '<input type="search" data-role="q" enterkeyhint="search" placeholder="Rechercher un poste…" aria-label="Rechercher un poste"></label>' +
        '<label class="case" style="margin:14px 4px 0"><input type="checkbox" data-role="soldes"> Afficher aussi les postes déjà soldés</label>' +
        '<div class="carte" style="margin-top:14px"><button class="ligne" data-pick="__nouveau__"><span class="pastille-ico">' + icone('plus') + '</span>' +
        '<span class="ligne-corps"><span class="ligne-titre">Créer un nouveau poste</span><span class="ligne-sous">Dépense non prévue au budget</span></span></button></div>' +
        '<div data-role="liste"></div>',
      apres: function (el, f) {
        function maj() {
          var c = k(), nq = norm(q);
          var html = '';
          etat.lots.forEach(function (l) {
            var groupe = etat.postes.filter(function (p) {
              if (p.lot !== l.id) return false;
              if (!soldes && !nq && c.parPoste[p.id].statut === 'solde') return false;
              return !nq || norm(p.nom + ' ' + p.prestataire).indexOf(nq) >= 0;
            });
            if (!groupe.length) return;
            html += '<section class="groupe"><h2 class="groupe-titre"><span>' + esc(lotLibelle(l.id)) + '</span></h2><div class="carte">' +
              groupe.map(function (p) {
                var s = c.parPoste[p.id];
                return '<button class="ligne" data-pick="' + esc(p.id) + '"><span class="ligne-corps"><span class="ligne-titre">' + esc(p.nom) + '</span>' +
                  (p.prestataire ? '<span class="ligne-sous">' + esc(p.prestataire) + '</span>' : '') + '</span><span class="ligne-droite">' +
                  (s.statut === 'solde' ? badge('solde') : '<span class="ligne-montant nombre cours">' + fmt(s.reste) + '</span><span class="discret">reste</span>') +
                  '</span></button>';
              }).join('') + '</div></section>';
          });
          el.querySelector('[data-role="liste"]').innerHTML = html ||
            '<div class="vide">Aucun poste à régler' + (nq ? ' ne correspond' : '') + '.<br>Cochez « Afficher aussi les postes déjà soldés » ou créez un nouveau poste.</div>';
        }
        el.querySelector('[data-role="q"]').addEventListener('input', function (e) { q = e.target.value; maj(); });
        el.querySelector('[data-role="soldes"]').addEventListener('change', function (e) { soldes = e.target.checked; maj(); });
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pick]');
          if (!b) return;
          fermerFeuille(f);
          if (b.dataset.pick === '__nouveau__') ouvrirPosteForm({ sansPaiement: true, surCreation: surChoix });
          else surChoix(b.dataset.pick);
        });
        maj();
      }
    });
  }

  // ------------------------------------------------------------ Création / modification d'un poste

  function lettreLibre() {
    for (var i = 0; i < 26; i++) {
      var l = String.fromCharCode(65 + i);
      if (!lot(l)) return l;
    }
    return 'L' + (etat.lots.length + 1);
  }

  function ouvrirPosteForm(o) {
    var p = o.id ? poste(o.id) : null;
    var lotDefaut = p ? p.lot : (o.lot || ui.lot || (etat.lots[0] ? etat.lots[0].id : ''));
    var titre = p ? 'Modifier le poste' : (o.depense ? 'Nouvelle dépense' : 'Nouveau poste');
    var reglement = o.depense ? 'total' : 'aucun';

    var corps = '<form class="formulaire" novalidate>' +
      '<label class="champ"><span>Intitulé</span><input name="nom" autocomplete="off" placeholder="Ex. : Achat ciment (1 tonne)" value="' + esc(p ? p.nom : '') + '">' +
      '<span class="erreur-champ" data-erreur="nom" hidden>Indiquez l\'intitulé du poste.</span></label>' +
      '<label class="champ"><span>Lot</span><select name="lot">' + optionsLots(lotDefaut) + '<option value="__nouveau__">➕ Nouveau lot…</option></select></label>' +
      '<label class="champ" data-role="nouveau-lot" hidden><span>Nom du nouveau lot</span><input name="nouveauLot" autocomplete="off" placeholder="Ex. : Mobilier & décoration"></label>' +
      '<label class="champ"><span>' + (o.depense ? 'Montant de la dépense (F CFA)' : 'Budget prévu (F CFA)') + '</span><input class="montant" name="budget" inputmode="numeric" autocomplete="off" placeholder="0" value="' +
      (p && p.budget ? fmt(p.budget) : '') + '"><span class="erreur-champ" data-erreur="budget" hidden>Indiquez le montant.</span></label>' +
      (p ? '<p class="discret" style="margin-top:-8px">Déjà payé sur ce poste : ' + fcfa(k().parPoste[p.id].paye) + '</p>' : '') +
      '<label class="champ"><span>Date</span><input type="date" name="date" value="' + esc(p ? p.date : aujourdhui()) + '"></label>' +
      '<label class="champ"><span>Prestataire / fournisseur</span><input name="prestataire" list="liste-prestataires" autocomplete="off" placeholder="Facultatif" value="' +
      esc(p ? p.prestataire : '') + '"></label>' + listePrestataires() +
      '<label class="champ"><span>Observations</span><textarea name="obs" rows="3" placeholder="Devis, quantités, détails…">' + esc(p ? p.obs : '') + '</textarea></label>' +
      (p || o.sansPaiement ? '' :
        '<div class="sous-section"><b>Paiement</b><div class="choix" role="radiogroup" aria-label="Paiement">' +
        [['aucun', 'Rien payé pour l\'instant'], ['total', 'Payé en totalité'], ['acompte', 'Acompte versé']].map(function (r) {
          return '<label><input type="radio" name="reglement" value="' + r[0] + '"' + (r[0] === reglement ? ' checked' : '') + '><span>' + r[1] + '</span></label>';
        }).join('') + '</div>' +
        '<label class="champ" data-role="acompte" hidden><span>Montant de l\'acompte (F CFA)</span><input class="montant" name="acompte" inputmode="numeric" autocomplete="off" placeholder="0">' +
        '<span class="erreur-champ" data-erreur="acompte" hidden>Indiquez le montant de l\'acompte.</span></label>' +
        '<div data-role="mode">' + champModes('') + '</div></div>') +
      '<div class="boutons"><button type="submit" class="btn principal">' + icone('coche') + (p ? ' Enregistrer les modifications' : ' Enregistrer') + '</button></div>' +
      '</form>';

    ouvrirFeuille({
      titre: titre,
      corps: corps,
      apres: function (el) {
        var form = el.querySelector('form');
        function majLot() { form.querySelector('[data-role="nouveau-lot"]').hidden = form.lot.value !== '__nouveau__'; }
        function majReglement() {
          if (!form.reglement) return;
          var r = valeurRadio(form, 'reglement');
          form.querySelector('[data-role="acompte"]').hidden = r !== 'acompte';
          form.querySelector('[data-role="mode"]').hidden = r === 'aucun';
        }
        form.lot.addEventListener('change', majLot);
        form.addEventListener('change', function (e) { if (e.target.name === 'reglement') majReglement(); });
        brancherMontant(form.budget, function () { form.querySelector('[data-erreur="budget"]').hidden = true; });
        if (form.acompte) brancherMontant(form.acompte);
        majLot();
        majReglement();
        if (!p) setTimeout(function () { form.nom.focus(); }, 280);

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var nom = form.nom.value.trim();
          var budget = lireMontant(form.budget.value);
          var reglement = form.reglement ? valeurRadio(form, 'reglement') : 'aucun';
          var acompte = form.acompte ? lireMontant(form.acompte.value) : 0;
          form.querySelector('[data-erreur="nom"]').hidden = !!nom;
          var budgetManquant = !budget && (o.depense || reglement === 'total');
          form.querySelector('[data-erreur="budget"]').hidden = !budgetManquant;
          var acompteManquant = reglement === 'acompte' && !acompte;
          if (form.acompte) form.querySelector('[data-erreur="acompte"]').hidden = !acompteManquant;
          if (!nom || budgetManquant || acompteManquant) return;

          var lotId = form.lot.value;
          if (lotId === '__nouveau__') {
            lotId = lettreLibre();
            etat.lots.push({ id: lotId, nom: form.nouveauLot.value.trim() || 'Nouveau lot' });
          }
          var champs = {
            nom: nom, lot: lotId, budget: Math.max(budget, reglement === 'acompte' ? acompte : 0),
            date: form.date.value || aujourdhui(), prestataire: form.prestataire.value.trim(), obs: form.obs.value.trim()
          };
          var cible = p;
          if (cible) {
            Object.assign(cible, champs);
          } else {
            cible = Object.assign({ id: uid('p') }, champs);
            etat.postes.push(cible);
            if (reglement !== 'aucun') {
              etat.paiements.push({
                id: uid('v'), posteId: cible.id, date: champs.date,
                montant: reglement === 'total' ? champs.budget : acompte,
                mode: valeurRadio(form, 'mode'), prestataire: champs.prestataire,
                notes: reglement === 'total' ? 'Payé en totalité' : 'Acompte'
              });
            }
          }
          sauver();
          fermerFeuille();
          toutRafraichir();
          if (o.surCreation) {
            o.surCreation(cible.id);
          } else if (!p) {
            var id = cible.id;
            toast(o.depense ? 'Dépense enregistrée' : 'Poste créé', { action: { libelle: 'Voir', fn: function () { ouvrirPoste(id); } } });
          } else {
            toast('Poste modifié');
          }
        });
      }
    });
  }

  function supprimerPoste(id) {
    var p = poste(id);
    if (!p) return;
    var liste = etat.paiements.filter(function (v) { return v.posteId === id; });
    var somme = liste.reduce(function (a, v) { return a + v.montant; }, 0);
    demander({
      titre: 'Supprimer ce poste ?',
      message: '« ' + p.nom + ' »' + (liste.length ? '\nSes ' + pluriel(liste.length, 'paiement') + ' (' + fcfa(somme) + ') seront aussi supprimés.' : ''),
      ok: 'Supprimer',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      avecAnnulation('Poste supprimé', function () {
        etat.postes = etat.postes.filter(function (x) { return x.id !== id; });
        etat.paiements = etat.paiements.filter(function (v) { return v.posteId !== id; });
      });
    });
  }

  // ------------------------------------------------------------ Bouton « + »

  function ouvrirAjout() {
    function choix(action, ico, titre, sous) {
      return '<button class="grand-choix" data-action="' + action + '" data-fermer="1"><span class="pastille-ico">' + icone(ico) + '</span>' +
        '<span class="ligne-corps"><b>' + titre + '</b><small>' + sous + '</small></span>' + icone('chevron', 'petite') + '</button>';
    }
    ouvrirFeuille({
      titre: 'Ajouter',
      corps: '<div class="carte">' +
        choix('nouveau-paiement', 'billet', 'Paiement sur un poste', 'Acompte, avance ou solde sur un poste existant') +
        choix('nouvelle-depense', 'recu', 'Nouvelle dépense', 'Achat ou prestation non encore enregistré (payé ou non)') +
        choix('nouveau-poste', 'liste', 'Nouveau poste budgété', 'Prévoir un budget (devis) à payer plus tard') +
        '</div>'
    });
  }

  // ------------------------------------------------------------ Prestataires

  function statsPrestataires() {
    var c = k(), groupes = {};
    function g(nom) {
      var cle = norm(nom.trim());
      return groupes[cle] || (groupes[cle] = { nom: nom.trim(), paye: 0, nbPaiements: 0, postes: [], reste: 0 });
    }
    etat.paiements.forEach(function (v) {
      if (!v.prestataire.trim()) return;
      var x = g(v.prestataire);
      x.paye += v.montant;
      x.nbPaiements++;
    });
    etat.postes.forEach(function (p) {
      if (!p.prestataire.trim()) return;
      var x = g(p.prestataire);
      x.postes.push(p);
      x.reste += Math.max(0, c.parPoste[p.id].reste);
    });
    return Object.keys(groupes).map(function (cle) { return groupes[cle]; })
      .sort(function (a, b) { return b.paye - a.paye || b.reste - a.reste; });
  }

  function ouvrirPrestataires() {
    ouvrirFeuille({
      titre: 'Prestataires',
      rendu: function () {
        var liste = statsPrestataires();
        if (!liste.length) return '<div class="vide">Aucun prestataire renseigné.</div>';
        return '<p class="discret" style="margin:0 4px 12px">Selon le prestataire indiqué sur les postes et les paiements.</p><div class="carte">' +
          liste.map(function (x, i) {
            return '<button class="ligne" data-action="voir-prestataire" data-i="' + i + '"><span class="pastille-ico">' + icone('personne') + '</span>' +
              '<span class="ligne-corps"><span class="ligne-titre">' + esc(x.nom) + '</span><span class="ligne-sous">' +
              pluriel(x.postes.length, 'poste') + ' · ' + pluriel(x.nbPaiements, 'paiement') + '</span></span>' +
              '<span class="ligne-droite"><span class="ligne-montant nombre">' + fmt(x.paye) + '</span>' +
              (x.reste > 0 ? '<span class="discret nombre cours">reste ' + fmt(x.reste) + '</span>' : '<span class="discret">versé</span>') + '</span></button>';
          }).join('') + '</div>';
      }
    });
  }

  function ouvrirPrestataire(i) {
    var nom = (statsPrestataires()[i] || {}).nom;
    if (!nom) return;
    ouvrirFeuille({
      titre: nom,
      rendu: function () {
        var x = statsPrestataires().filter(function (y) { return norm(y.nom) === norm(nom); })[0];
        if (!x) return null;
        var paiements = paiementsTries(etat.paiements.filter(function (v) { return norm(v.prestataire.trim()) === norm(nom); }));
        return '<div class="carte"><div class="cle-valeur"><span>Total versé</span><b class="nombre ok">' + fcfa(x.paye) + '</b></div>' +
          '<div class="cle-valeur"><span>Reste à payer (ses postes)</span><b class="nombre cours">' + fcfa(x.reste) + '</b></div></div>' +
          (x.postes.length ? '<section class="section"><h2 class="section-titre"><span>Postes</span></h2><div class="carte">' +
            x.postes.map(function (p) { return lignePoste(p); }).join('') + '</div></section>' : '') +
          (paiements.length ? '<section class="section"><h2 class="section-titre"><span>Paiements</span></h2><div class="carte">' +
            paiements.map(function (v) { return lignePaiement(v, { avecDate: true }); }).join('') + '</div></section>' : '');
      }
    });
  }

  // ------------------------------------------------------------ Paramètres : projet et lots

  function formulaireSimple(titre, champsHtml, surEnvoi) {
    ouvrirFeuille({
      titre: titre,
      corps: '<form class="formulaire" novalidate>' + champsHtml +
        '<div class="boutons"><button type="submit" class="btn principal">' + icone('coche') + ' Enregistrer</button></div></form>',
      apres: function (el) {
        var form = el.querySelector('form');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (surEnvoi(form) === false) return;
          sauver();
          fermerFeuille();
          toutRafraichir();
        });
      }
    });
  }

  function ouvrirProjet() {
    formulaireSimple('Nom du projet',
      '<label class="champ"><span>Nom</span><input name="nom" autocomplete="off" value="' + esc(etat.projet.nom) + '"></label>' +
      '<label class="champ"><span>Sous-titre</span><input name="sous" autocomplete="off" value="' + esc(etat.projet.sousTitre) + '"></label>',
      function (form) {
        etat.projet.nom = form.nom.value.trim() || 'Colombe 3';
        etat.projet.sousTitre = form.sous.value.trim();
      });
  }

  function ouvrirLots() {
    ouvrirFeuille({
      titre: 'Lots de travaux',
      rendu: function () {
        var c = k();
        return '<div class="carte">' + etat.lots.map(function (l) {
          var s = c.parLot[l.id] || { nb: 0 };
          return '<button class="ligne" data-action="modifier-lot" data-lot="' + esc(l.id) + '"><span class="pastille-ico"><b>' + esc(l.id) + '</b></span>' +
            '<span class="ligne-corps"><span class="ligne-titre">' + esc(l.nom || 'Sans nom') + '</span><span class="ligne-sous">' +
            pluriel(s.nb, 'poste') + (s.nb ? ' · budget ' + fmt(s.budget) + ' F' : '') + '</span></span>' + icone('crayon', 'petite') + '</button>';
        }).join('') + '</div><div class="boutons"><button class="btn" data-action="ajouter-lot">' + icone('plus') + ' Ajouter un lot</button></div>';
      }
    });
  }

  function ouvrirLot(id) {
    var l = id ? lot(id) : null;
    var nb = l ? (k().parLot[l.id] || { nb: 0 }).nb : 0;
    ouvrirFeuille({
      titre: l ? 'Lot ' + l.id : 'Nouveau lot',
      corps: '<form class="formulaire" novalidate><label class="champ"><span>Nom du lot</span><input name="nom" autocomplete="off" placeholder="Ex. : Mobilier & décoration" value="' +
        esc(l ? l.nom : '') + '"></label><div class="boutons"><button type="submit" class="btn principal">' + icone('coche') + ' Enregistrer</button></div>' +
        (l ? '<div class="boutons"><button type="button" class="btn danger" data-role="supprimer"' + (nb ? ' disabled' : '') + '>' + icone('poubelle') + ' Supprimer ce lot</button></div>' +
          (nb ? '<p class="discret">Un lot ne peut être supprimé que s\'il ne contient aucun poste (' + pluriel(nb, 'poste') + ' actuellement).</p>' : '') : '') + '</form>',
      apres: function (el) {
        var form = el.querySelector('form');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var nom = form.nom.value.trim();
          if (l) l.nom = nom;
          else etat.lots.push({ id: lettreLibre(), nom: nom || 'Nouveau lot' });
          sauver();
          fermerFeuille();
          toutRafraichir();
        });
        var sup = form.querySelector('[data-role="supprimer"]');
        if (sup) {
          sup.addEventListener('click', function () {
            fermerFeuille();
            avecAnnulation('Lot supprimé', function () {
              etat.lots = etat.lots.filter(function (x) { return x.id !== l.id; });
            });
          });
        }
      }
    });
  }

  // ------------------------------------------------------------ Partage, export, sauvegarde

  function texteResume() {
    var c = k(), t = c.total;
    var l = ['🏠 ' + etat.projet.nom + ' — Point budgétaire du ' + dateFr(aujourdhui()), '',
      'Budget total : ' + fcfa(t.budget),
      'Montant payé : ' + fcfa(t.paye) + ' (' + pct(t.taux) + ')',
      'Reste à décaisser : ' + fcfa(t.reste), '', 'Par lot :'];
    etat.lots.forEach(function (lo) {
      var s = c.parLot[lo.id];
      if (!s || !s.nb) return;
      l.push('• ' + lotLibelle(lo.id) + ' : ' + (s.reste > 0 ? 'reste ' + fmt(s.reste) + ' F (payé ' + pct(s.taux) + ')' : 'soldé ✅'));
    });
    var prio = prioritaires(5);
    if (prio.length) {
      l.push('', 'Restes à payer prioritaires :');
      prio.forEach(function (p, i) { l.push((i + 1) + '. ' + p.nom + ' : ' + fmt(c.parPoste[p.id].reste) + ' F'); });
    }
    return l.join('\n');
  }

  function partagerPoint() {
    var texte = texteResume(), titre = etat.projet.nom + ' — point budgétaire';
    if (pont) {
      try { pont.partagerTexte(titre, texte); } catch (e) { toast('Partage impossible : ' + e.message, { type: 'erreur' }); }
      return;
    }
    if (navigator.share) { navigator.share({ title: titre, text: texte }).catch(function () {}); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(texte).then(function () { toast('Résumé copié dans le presse-papiers'); });
    }
  }

  function enBase64(octets) {
    var bin = '';
    for (var i = 0; i < octets.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function depuisBase64(b64) {
    var bin = atob(b64), octets = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
    return octets;
  }

  /** Remet un fichier à l'utilisateur : enregistrement (Téléchargements) ou partage. */
  function livrer(nom, b64, mime, mode) {
    if (pont) {
      try {
        if (mode === 'partager') {
          if (!pont.partagerFichier(nom, b64, mime)) toast('Le partage a échoué.', { type: 'erreur' });
        } else {
          var message = pont.enregistrerFichier(nom, b64, mime);
          if (message) toast(message, { type: /^Échec|invalide/.test(message) ? 'erreur' : '' });
        }
      } catch (e) {
        toast('Opération impossible : ' + e.message, { type: 'erreur' });
      }
      return;
    }
    var blob = new Blob([depuisBase64(b64)], { type: mime });
    if (mode === 'partager' && window.File && navigator.canShare) {
      var fichier = new File([blob], nom, { type: mime });
      if (navigator.canShare({ files: [fichier] })) {
        navigator.share({ files: [fichier], title: nom }).catch(function () {});
        return;
      }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Fichier téléchargé : ' + nom);
  }

  function choisirSortie(titre, message) {
    return demander({
      titre: titre,
      message: message,
      boutons: [
        { libelle: 'Annuler', valeur: null },
        { libelle: 'Partager', valeur: 'partager' },
        { libelle: 'Enregistrer', valeur: 'enregistrer', classe: 'principal' }
      ]
    });
  }

  function nomFichier(prefixe, extension) {
    return prefixe + '_' + aujourdhui() + '.' + extension;
  }

  function exporterSauvegarde() {
    choisirSortie('Exporter une sauvegarde',
      '« Enregistrer » place le fichier dans Téléchargements ; « Partager » l\'envoie (WhatsApp, Gmail, Drive…).')
      .then(function (mode) {
        if (!mode) return;
        etat.sauvegardeLe = new Date().toISOString();
        sauver(true);
        var octets = new TextEncoder().encode(JSON.stringify(etat, null, 1));
        livrer(nomFichier('Colombe3_sauvegarde', 'json'), enBase64(octets), 'application/json', mode);
        toutRafraichir();
      });
  }

  function importerSauvegarde() {
    var input = $('#fichier-import');
    input.value = '';
    input.click();
  }

  function surFichierImporte() {
    var input = $('#fichier-import');
    var f = input.files && input.files[0];
    if (!f) return;
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var d = analyser(String(lecteur.result || ''));
      if (!d) {
        toast('Fichier non reconnu : choisissez une sauvegarde .json exportée par l\'application.', { type: 'erreur' });
        return;
      }
      demander({
        titre: 'Restaurer cette sauvegarde ?',
        message: 'Les données actuelles (' + pluriel(etat.postes.length, 'poste') + ', ' + pluriel(etat.paiements.length, 'paiement') +
          ') seront remplacées par celles du fichier (' + pluriel(d.postes.length, 'poste') + ', ' + pluriel(d.paiements.length, 'paiement') +
          (d.modifieLe ? ', modifié le ' + dateFr(String(d.modifieLe).slice(0, 10)) : '') + ').',
        ok: 'Restaurer',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        avecAnnulation('Sauvegarde restaurée', function () { etat = normaliser(d); });
      });
    };
    lecteur.onerror = function () { toast('Lecture du fichier impossible.', { type: 'erreur' }); };
    lecteur.readAsText(f);
  }

  function reinitialiser() {
    demander({
      titre: 'Revenir aux données du classeur ?',
      message: 'Toutes les saisies faites dans l\'application seront remplacées par les données d\'origine du classeur Excel ' +
        '(' + pluriel(INITIALES.postes.length, 'poste') + ', ' + pluriel(INITIALES.paiements.length, 'paiement') + '). Vous pourrez annuler juste après.',
      ok: 'Réinitialiser',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      avecAnnulation('Données réinitialisées', function () { etat = normaliser(copie(INITIALES)); });
    });
  }

  function chargerXlsx() {
    return new Promise(function (ok, ko) {
      if (window.XLSX) return ok(window.XLSX);
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.mini.min.js';
      s.onload = function () { ok(window.XLSX); };
      s.onerror = function () { ko(new Error('module Excel introuvable')); };
      document.head.appendChild(s);
    });
  }

  function exporterExcel() {
    choisirSortie('Exporter en Excel', 'Classeur .xlsx avec le tableau de bord, le suivi détaillé et l\'historique des paiements.')
      .then(function (mode) {
        if (!mode) return;
        return chargerXlsx().then(function (X) {
          var b64 = X.write(construireClasseur(X), { bookType: 'xlsx', type: 'base64', compression: true });
          livrer(nomFichier('Colombe3_Suivi', 'xlsx'), b64, MIME_XLSX, mode);
        });
      })
      .catch(function (e) { toast('Export impossible : ' + e.message, { type: 'erreur' }); });
  }

  /** Classeur au format du fichier d'origine (formules conservées). */
  function construireClasseur(X) {
    var c = k(), t = c.total;
    var FMT = '#,##0', FMT_PCT = '0.0%', FMT_DATE = 'dd/mm/yyyy';
    function nb(v) { return { t: 'n', v: v, z: FMT }; }
    function date(iso) {
      if (!iso) return '';
      var p = iso.split('-').map(Number);
      return { t: 'n', v: (Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 864e5, z: FMT_DATE };
    }
    function formule(f, v, z) { return { t: 'n', f: f, v: v, z: z || FMT }; }

    // Suivi détaillé
    var suivi = [['POSTE DE TRAVAUX', 'DATE', 'PRESTATAIRE', 'BUDGET (F CFA)', 'MONTANT PAYÉ', 'RESTE À PAYER', '% RÉALISÉ', 'STATUT', 'OBSERVATIONS', 'LOT']];
    etat.lots.forEach(function (l) {
      var postes = etat.postes.filter(function (p) { return p.lot === l.id; });
      if (!postes.length) return;
      suivi.push(['▌ ' + lotLibelle(l.id).toUpperCase()]);
      postes.forEach(function (p) {
        var s = c.parPoste[p.id], r = suivi.length + 1;
        suivi.push([p.nom, date(p.date), p.prestataire, nb(p.budget), nb(s.paye),
          formule('D' + r + '-E' + r, s.reste), formule('IF(D' + r + '>0,E' + r + '/D' + r + ',0)', p.budget > 0 ? s.paye / p.budget : 0, FMT_PCT),
          STATUTS[s.statut].libelle, p.obs, lotLibelle(p.lot)]);
      });
    });
    var fin = suivi.length;
    suivi.push(['TOTAL', '', '', formule('SUM(D2:D' + fin + ')', t.budget), formule('SUM(E2:E' + fin + ')', t.paye),
      formule('SUM(F2:F' + fin + ')', t.reste), formule('IF(D' + (fin + 1) + '>0,E' + (fin + 1) + '/D' + (fin + 1) + ',0)', t.taux, FMT_PCT)]);
    var fSuivi = X.utils.aoa_to_sheet(suivi);
    fSuivi['!cols'] = [{ wch: 52 }, { wch: 11 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 11 }, { wch: 70 }, { wch: 40 }];
    fSuivi['!autofilter'] = { ref: 'A1:J' + fin };

    // Historique
    var ordre = {};
    etat.paiements.forEach(function (v, i) { ordre[v.id] = i; });
    var paiements = etat.paiements.slice().sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? -1 : 1) : ordre[a.id] - ordre[b.id];
    });
    var histo = [['DATE', 'POSTE', 'LOT', 'PRESTATAIRE', 'MONTANT (F CFA)', 'MODE', 'RÉFÉRENCE / NOTES']];
    paiements.forEach(function (v) {
      var p = poste(v.posteId);
      histo.push([date(v.date), p ? p.nom : '(poste supprimé)', p ? lotLibelle(p.lot) : '', v.prestataire, nb(v.montant), v.mode, v.notes]);
    });
    histo.push(['TOTAL PAIEMENTS ENREGISTRÉS', '', '', '', formule('SUM(E2:E' + histo.length + ')', t.paye)]);
    var fHisto = X.utils.aoa_to_sheet(histo);
    fHisto['!cols'] = [{ wch: 12 }, { wch: 52 }, { wch: 36 }, { wch: 22 }, { wch: 16 }, { wch: 13 }, { wch: 70 }];
    fHisto['!autofilter'] = { ref: 'A1:G' + (histo.length - 1) };

    // Tableau de bord
    var plage = "'Suivi détaillé'!";
    var tdb = [
      [etat.projet.nom.toUpperCase() + (etat.projet.sousTitre ? ' — ' + etat.projet.sousTitre : '')],
      ['Exporté le ' + dateFr(aujourdhui()) + ' depuis l\'application Colombe 3'],
      [],
      ['BUDGET TOTAL', 'MONTANT PAYÉ', 'RESTE À DÉCAISSER', 'AVANCEMENT']
    ];
    var debutLots = 8, finLots = debutLots + etat.lots.length - 1;
    tdb.push([formule('SUM(B' + debutLots + ':B' + finLots + ')', t.budget), formule('SUM(C' + debutLots + ':C' + finLots + ')', t.paye),
      formule('A5-B5', t.reste), formule('IF(A5>0,B5/A5,0)', t.taux, FMT_PCT)]);
    tdb.push([], ['LOT', 'BUDGET (F CFA)', 'PAYÉ (F CFA)', 'RESTE (F CFA)', 'AVANCEMENT', 'POSTES', 'SOLDÉS']);
    etat.lots.forEach(function (l, i) {
      var s = c.parLot[l.id] || { budget: 0, paye: 0, reste: 0, taux: 0, nb: 0, soldes: 0 }, r = debutLots + i, crit = '"' + lotLibelle(l.id).replace(/"/g, '""') + '"';
      tdb.push([lotLibelle(l.id),
        formule('SUMIF(' + plage + '$J:$J,' + crit + ',' + plage + '$D:$D)', s.budget),
        formule('SUMIF(' + plage + '$J:$J,' + crit + ',' + plage + '$E:$E)', s.paye),
        formule('B' + r + '-C' + r, s.reste), formule('IF(B' + r + '>0,C' + r + '/B' + r + ',0)', s.taux, FMT_PCT),
        s.nb, s.soldes]);
    });
    tdb.push([], ['POSTES PRIORITAIRES À RÉGLER (restes à payer les plus élevés)'], ['POSTE', 'LOT', 'RESTE (F CFA)', 'STATUT', 'PRESTATAIRE']);
    prioritaires(10).forEach(function (p) {
      var s = c.parPoste[p.id];
      tdb.push([p.nom, lotLibelle(p.lot), nb(s.reste), STATUTS[s.statut].libelle, p.prestataire]);
    });
    var fTdb = X.utils.aoa_to_sheet(tdb);
    fTdb['!cols'] = [{ wch: 50 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 13 }, { wch: 9 }, { wch: 9 }];

    var classeur = X.utils.book_new();
    X.utils.book_append_sheet(classeur, fTdb, 'Tableau de bord');
    X.utils.book_append_sheet(classeur, fSuivi, 'Suivi détaillé');
    X.utils.book_append_sheet(classeur, fHisto, 'Historique');
    classeur.Props = { Title: etat.projet.nom + ' — Suivi budgétaire', Author: 'Application Colombe 3' };
    return classeur;
  }

  // ------------------------------------------------------------ Événements

  var ACTIONS = {
    'onglet': function (d) { allerA(d.onglet); },
    'ajouter': ouvrirAjout,
    'fermer-feuille': function () { fermerFeuille(); },
    'partager-point': partagerPoint,
    'voir-poste': function (d) { ouvrirPoste(d.id); },
    'voir-lot': function (d) { ui.lot = d.lot; ui.statut = 'tous'; ui.recherche = ''; allerA('postes'); },
    'voir-statut': function (d) { ui.statut = d.valeur; ui.lot = ''; ui.recherche = ''; allerA('postes'); },
    'filtre': function (d) {
      if (d.filtre === 'statut') ui.statut = d.valeur;
      else ui.hMois = d.valeur;
      rendre();
    },
    'payer': function (d) { ouvrirPaiement({ posteId: d.id }); },
    'solder': function (d) { ouvrirPaiement({ posteId: d.id, solder: true }); },
    'nouveau-paiement': function () { ouvrirPaiement({}); },
    'modifier-paiement': function (d) { if (paiement(d.id)) ouvrirPaiement({ paiementId: d.id }); },
    'nouvelle-depense': function () { ouvrirPosteForm({ depense: true }); },
    'nouveau-poste': function () { ouvrirPosteForm({}); },
    'modifier-poste': function (d) { if (poste(d.id)) ouvrirPosteForm({ id: d.id }); },
    'supprimer-poste': function (d) { supprimerPoste(d.id); },
    'prestataires': ouvrirPrestataires,
    'voir-prestataire': function (d) { ouvrirPrestataire(+d.i); },
    'projet': ouvrirProjet,
    'lots': ouvrirLots,
    'modifier-lot': function (d) { ouvrirLot(d.lot); },
    'ajouter-lot': function () { ouvrirLot(null); },
    'export-excel': exporterExcel,
    'export-sauvegarde': exporterSauvegarde,
    'import-sauvegarde': importerSauvegarde,
    'reinitialiser': reinitialiser
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var action = ACTIONS[el.dataset.action];
    if (!action) return;
    e.preventDefault();
    if (el.dataset.fermer) fermerFeuille();
    action(el.dataset, el);
  });

  document.addEventListener('input', function (e) {
    var champ = e.target.dataset && e.target.dataset.input;
    if (champ === 'recherche') { ui.recherche = e.target.value; $('#liste-postes').innerHTML = listePostes(); }
    if (champ === 'h-recherche') { ui.hRecherche = e.target.value; $('#liste-historique').innerHTML = listeHistorique(); }
  });

  document.addEventListener('change', function (e) {
    var champ = e.target.dataset && e.target.dataset.input;
    if (champ === 'lot') { ui.lot = e.target.value; $('#liste-postes').innerHTML = listePostes(); }
    if (champ === 'h-lot') { ui.hLot = e.target.value; $('#liste-historique').innerHTML = listeHistorique(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.type === 'search') e.target.blur();
    if (e.key === 'Escape') window.retourArriere();
  });

  $('#fichier-import').addEventListener('change', surFichierImporte);

  // ------------------------------------------------------------ Démarrage

  if (pont) {
    try {
      var m = JSON.parse(pont.marges());
      window.appliquerMarges(m.haut, m.bas);
    } catch (e) { /* marges par défaut */ }
  }
  charger();
  rendre();
})();
