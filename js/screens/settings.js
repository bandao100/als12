import { formatDistance, toLocalXY } from '../core/geo.js';
import { icons } from '../core/icons.js';
import { isNative, nativeCall, nativeInfo } from '../core/native.js';
import { CATEGORIES } from '../core/radar-logic.js';
import { settings } from '../core/store.js';
import { $, el, escapeHtml, toast } from '../core/ui.js';
import { radarService } from '../services/radar-service.js';

export const APP_VERSION = '1.1.0';
export const APK_URL = 'https://github.com/bandao100/als12/releases/download/android/sentinelle.apk';

const SWITCHES = [
  ['voice', 'Alertes vocales', 'Annonce le type de radar, la distance et la limite.'],
  ['sound', 'Bips et crépitements', 'Signaux sonores des alertes et des détecteurs.'],
  ['vibrate', 'Vibrations', 'Retour haptique lors des détections (Android).'],
  ['dangerZones', 'Mode zones de danger', 'Masque la position exacte des radars et annonce des zones de 2 km, comme l’exige la loi française.'],
  ['demo', 'Mode démonstration', 'Remplace tous les capteurs par des données simulées pour découvrir l’application.'],
];

export function settingsScreen(ctx) {
  const root = el(`
    <section class="screen" aria-labelledby="s-title">
      <div class="screen-head">
        <span class="eyebrow">Réglages</span>
        <h1 id="s-title">Préférences</h1>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Affichage</h2></div>
        <div class="field">
          <div class="field-label"><strong>Thème</strong><span>Le thème clair reste lisible en plein soleil.</span></div>
          <div class="seg" id="s-theme" role="group" aria-label="Thème">
            <button type="button" data-theme="auto">Auto</button>
            <button type="button" data-theme="dark">${icons.moon.replace('<svg', '<svg width="16" height="16"')}</button>
            <button type="button" data-theme="light">${icons.sun.replace('<svg', '<svg width="16" height="16"')}</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Alertes</h2></div>
        ${SWITCHES.map(
          ([k, t, d]) => `<label class="field" for="s-${k}"><span class="field-label"><strong>${t}</strong><span>${d}</span></span><input class="switch" type="checkbox" id="s-${k}" data-key="${k}"></label>`,
        ).join('')}
        <div class="field">
          <div class="field-label" style="flex:1"><strong>Anticipation</strong><span id="s-look-label"></span>
            <input type="range" id="s-look" min="15" max="60" step="5" aria-label="Anticipation des alertes en secondes">
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Points à signaler</h2></div>
        ${Object.entries(CATEGORIES)
          .map(
            ([k, v]) => `<label class="field" for="s-cat-${k}"><span class="field-label"><strong>${v.label}</strong>${k === 'surveillance' ? '<span>Caméras recensées dans OpenStreetMap, sur 2 km. Affichées sans alerte vocale.</span>' : ''}</span><input class="switch" type="checkbox" id="s-cat-${k}" data-cat="${k}"></label>`,
          )
          .join('')}
      </div>

      <div class="panel">
        <div class="section-title"><h2>Mes signalements</h2><span class="small muted">Conservés 7 jours</span></div>
        <ul class="list" id="s-reported"></ul>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Application</h2></div>
        <p class="small muted" id="s-app-info" style="margin-top:6px"></p>
        <div class="btn-row" style="margin-top:10px">
          <a class="btn btn-primary" id="s-apk" href="${APK_URL}" target="_blank" rel="noopener">${icons.phone}<span>Télécharger l’application Android</span></a>
          <button class="btn" id="s-perms" type="button" hidden>${icons.settings}<span>Autorisations de l’application</span></button>
          <button class="btn" id="s-install" type="button">${icons.phone}<span>Installer sur l’écran d’accueil</span></button>
          <button class="btn" id="s-cache" type="button">${icons.trash}<span>Vider le cache des radars</span></button>
        </div>
        <p class="small muted" id="s-install-help" style="margin-top:10px" hidden>Sur iPhone : touchez Partager puis « Sur l’écran d’accueil ». Sur Android : menu ⋮ puis « Installer l’application ».</p>
      </div>

      <div class="note">${icons.info}
        <p><strong>Confidentialité.</strong> Images, sons et mesures sont analysés sur votre téléphone et ne sont jamais enregistrés ni transmis. Seule votre position est envoyée au service Overpass d’OpenStreetMap pour télécharger les radars dans un rayon de 8 km. Données cartographiques © contributeurs OpenStreetMap, licence ODbL. Sentinelle ${APP_VERSION}.</p>
      </div>
    </section>`);

  function renderTheme() {
    const t = settings.get('theme');
    root.querySelectorAll('#s-theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
    $('#s-theme [data-theme="dark"]', root).setAttribute('aria-label', 'Sombre');
    $('#s-theme [data-theme="light"]', root).setAttribute('aria-label', 'Clair');
  }

  function renderSwitches() {
    root.querySelectorAll('input[data-key]').forEach((i) => (i.checked = !!settings.get(i.dataset.key)));
    const cats = settings.get('categories');
    root.querySelectorAll('input[data-cat]').forEach((i) => (i.checked = !!cats[i.dataset.cat]));
    const look = settings.get('lookAhead');
    $('#s-look', root).value = look;
    $('#s-look-label', root).textContent = `Prévenir ${look} s avant le radar (${formatDistance((90 / 3.6) * look)} à 90 km/h).`;
  }

  function renderReported() {
    const ul = $('#s-reported', root);
    const items = radarService.reported;
    if (!items.length) {
      ul.innerHTML = `<li class="empty">Aucun signalement. Pendant la surveillance, touchez « Signaler ici » pour ajouter un radar mobile.</li>`;
      return;
    }
    const pos = radarService.state.pos;
    ul.innerHTML = items
      .map((p) => {
        const when = new Date(p.at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        const d = pos ? (() => { const { x, y } = toLocalXY(pos, p); return ` · à ${formatDistance(Math.hypot(x, y))}`; })() : '';
        return `<li><span class="kind-badge">${icons.pin}</span><div class="grow"><div class="title">Signalé ${escapeHtml(when)}</div><div class="sub mono">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${d}</div></div><button class="icon-btn" type="button" data-remove="${escapeHtml(p.id)}" aria-label="Supprimer ce signalement">${icons.trash}</button></li>`;
      })
      .join('');
  }

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.key) settings.set(t.dataset.key, t.checked);
    if (t.dataset.cat) settings.setCategory(t.dataset.cat, t.checked);
  });
  $('#s-look', root).addEventListener('input', (e) => {
    settings.set('lookAhead', Number(e.target.value));
    renderSwitches();
  });
  $('#s-theme', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]');
    if (b) settings.set('theme', b.dataset.theme);
  });
  $('#s-reported', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-remove]');
    if (!b) return;
    radarService.removeReported(b.dataset.remove);
    renderReported();
  });
  function renderApp() {
    const info = nativeInfo();
    $('#s-apk', root).hidden = isNative;
    $('#s-install', root).hidden = isNative;
    $('#s-perms', root).hidden = !isNative;
    $('#s-app-info', root).textContent = isNative
      ? `Application Android ${info?.version || ''} sur ${info?.model || 'ce téléphone'} (Android ${info?.release || '?'}). Capteurs natifs : magnétomètre, boussole, Bluetooth, Wi-Fi, voix.`
      : "L'application Android (APK) donne accès au magnétomètre, au scan Bluetooth complet et à l'analyse Wi-Fi sans aucun réglage caché.";
  }
  $('#s-perms', root).addEventListener('click', () => nativeCall('settings', 'app').catch(() => {}));

  $('#s-cache', root).addEventListener('click', () => {
    radarService.clearCache();
    toast('Cache vidé : les radars seront retéléchargés au prochain démarrage.');
  });
  $('#s-install', root).addEventListener('click', async () => {
    const prompt = ctx.installPrompt();
    if (!prompt) {
      $('#s-install-help', root).hidden = false;
      return;
    }
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
  });

  const onSettings = (key) => {
    if (key === 'theme') renderTheme();
    else renderSwitches();
  };
  let unsub = null;
  return {
    root,
    mount() {
      renderTheme();
      renderSwitches();
      renderReported();
      renderApp();
      unsub = settings.subscribe(onSettings);
    },
    unmount() {
      unsub?.();
    },
  };
}
