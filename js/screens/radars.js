import { unlockAudio } from '../core/audio.js';
import { cardinal, formatDistance } from '../core/geo.js';
import { icons, shapeSvg } from '../core/icons.js';
import { CATEGORIES } from '../core/radar-logic.js';
import { settings } from '../core/store.js';
import { $, el, escapeHtml, themeColors, timeAgo, toast } from '../core/ui.js';
import { radarService } from '../services/radar-service.js';
import { categoryColor, createScope } from './scope.js';

const RANGES = [1000, 2000, 5000];

export function radarsScreen() {
  const root = el(`
    <section class="screen" aria-labelledby="r-title">
      <div class="screen-head">
        <span class="eyebrow">Radars routiers</span>
        <h1 id="r-title">Surveillance de la route</h1>
        <p>Alerte vocale avant chaque radar fixe, feu rouge ou tronçon situé devant vous, d'après OpenStreetMap et vos propres signalements.</p>
      </div>

      <div class="readouts">
        <div class="speed">
          <span class="speed-value" id="r-speed">—</span>
          <span class="speed-unit">km/h</span>
        </div>
        <div class="limit-sign unknown" id="r-limit" aria-label="Limitation de vitesse">—</div>
        <div class="heading-readout">
          <div class="mono" id="r-heading">—</div>
          <div class="small muted" id="r-heading-src">Cap</div>
        </div>
      </div>

      <div class="scope-wrap"><canvas id="r-scope" aria-label="Radar des points à proximité" role="img"></canvas></div>

      <div class="alert-banner" id="r-alert" aria-live="assertive">
        <div class="alert-icon" id="r-alert-icon">${icons.radar}</div>
        <div>
          <div class="alert-title" id="r-alert-title">Surveillance à l'arrêt</div>
          <div class="small muted" id="r-alert-sub">Démarrez pour recevoir les alertes.</div>
        </div>
        <div class="alert-dist" id="r-alert-dist"></div>
        <span class="alert-bar" id="r-alert-bar" style="width:0"></span>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="r-toggle" type="button">${icons.play}<span>Démarrer la surveillance</span></button>
        <button class="btn" id="r-report" type="button" disabled>${icons.pin}<span>Signaler ici</span></button>
      </div>

      <div class="seg" id="r-range" role="group" aria-label="Portée du radar">
        ${RANGES.map((r) => `<button type="button" data-range="${r}">${formatDistance(r)}</button>`).join('')}
      </div>

      <div class="legend" id="r-legend"></div>

      <div class="stats">
        <div class="stat"><span class="stat-label">Points</span><span class="stat-value" id="r-count">0</span></div>
        <div class="stat"><span class="stat-label">Préavis</span><span class="stat-value" id="r-anticip">—</span></div>
        <div class="stat"><span class="stat-label">Précision</span><span class="stat-value" id="r-acc">—</span></div>
      </div>
      <p class="small muted" id="r-source">Source : OpenStreetMap (contributeurs ODbL).</p>

      <div class="panel">
        <div class="section-title"><h2>À proximité</h2><span class="small muted" id="r-near-count"></span></div>
        <ul class="list" id="r-list"></ul>
      </div>

      <div class="note">${icons.info}
        <p><strong>Un téléphone ne capte pas les ondes radar.</strong> Les cinémomètres émettent en bande K ou Ka (24 à 35 GHz), hors de portée de toute antenne de smartphone. Sentinelle s'appuie donc sur la position connue des radars. Dans plusieurs pays, dont la France, les détecteurs d'ondes sont interdits et seules les « zones de danger » peuvent être annoncées : activez ce mode dans les réglages si votre législation l'exige.</p>
      </div>
    </section>`);

  const scope = { instance: null };
  const getState = () => ({ ...radarService.state, range: settings.get('range'), dangerZones: settings.get('dangerZones') });

  function renderLegend() {
    const c = themeColors();
    const cats = settings.get('categories');
    $('#r-legend', root).innerHTML = Object.entries(CATEGORIES)
      .filter(([k]) => cats[k])
      .map(([k, v]) => `<span>${shapeSvg(v.shape, categoryColor(k, c))}${escapeHtml(v.short)}</span>`)
      .join('');
  }

  function renderRange() {
    const r = settings.get('range');
    root.querySelectorAll('#r-range button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === r)));
  }

  function render() {
    const s = radarService.state;
    const danger = settings.get('dangerZones');
    const toggle = $('#r-toggle', root);
    toggle.className = `btn ${s.running ? 'btn-danger' : 'btn-primary'}`;
    // En conduite, on libère de la place pour garder radar et alerte sur un seul écran.
    root.classList.toggle('driving', s.running);
    toggle.innerHTML = s.running ? `${icons.stop}<span>Arrêter</span>` : `${icons.play}<span>Démarrer la surveillance</span>`;
    $('#r-report', root).disabled = !s.pos || !s.running;

    const speed = $('#r-speed', root);
    speed.textContent = s.speedKmh != null && s.running ? Math.round(s.speedKmh) : '—';
    speed.classList.toggle('over', s.overspeed);

    const limitEl = $('#r-limit', root);
    const limit = !danger && s.alert?.point.maxspeed;
    limitEl.textContent = limit || '—';
    limitEl.classList.toggle('unknown', !limit);

    $('#r-heading', root).textContent = s.heading != null ? `${Math.round(s.heading)}° ${cardinal(s.heading)}` : '—';
    $('#r-heading-src', root).textContent = s.headingSource ? `Cap · ${s.headingSource}` : 'Cap';

    const banner = $('#r-alert', root);
    const a = s.alert;
    if (a) {
      const level = s.overspeed ? 'imminent' : a.distance <= Math.min(250, s.alertDistance * 0.3) ? 'imminent' : a.distance <= s.alertDistance * 0.6 ? 'near' : 'far';
      banner.dataset.level = level;
      $('#r-alert-icon', root).innerHTML = icons.alert;
      const cat = CATEGORIES[a.point.category];
      $('#r-alert-title', root).textContent = danger ? 'Zone de danger' : cat.label;
      $('#r-alert-sub', root).textContent = danger
        ? 'Restez vigilant et respectez les limitations.'
        : [a.point.maxspeed ? `Limité à ${a.point.maxspeed} km/h` : 'Limite inconnue', a.point.source === 'moi' ? 'votre signalement' : null, s.overspeed ? 'RALENTISSEZ' : null].filter(Boolean).join(' · ');
      $('#r-alert-dist', root).textContent = danger ? `< ${formatDistance(Math.ceil(a.distance / 500) * 500)}` : formatDistance(a.distance);
      $('#r-alert-bar', root).style.width = `${Math.max(4, 100 - (a.distance / s.alertDistance) * 100)}%`;
    } else {
      delete banner.dataset.level;
      $('#r-alert-icon', root).innerHTML = icons.radar;
      $('#r-alert-dist', root).textContent = '';
      $('#r-alert-bar', root).style.width = '0';
      if (!s.running) {
        $('#r-alert-title', root).textContent = "Surveillance à l'arrêt";
        $('#r-alert-sub', root).textContent = 'Démarrez pour recevoir les alertes vocales.';
      } else if (s.status === 'error') {
        $('#r-alert-title', root).textContent = 'GPS indisponible';
        $('#r-alert-sub', root).textContent = s.error;
      } else if (!s.pos) {
        $('#r-alert-title', root).textContent = 'Localisation en cours';
        $('#r-alert-sub', root).textContent = 'Autorisez la position et gardez le téléphone à découvert.';
      } else {
        $('#r-alert-title', root).textContent = 'Route dégagée';
        $('#r-alert-sub', root).textContent = `Aucun radar devant vous dans les ${formatDistance(s.alertDistance)}.`;
      }
    }

    $('#r-count', root).textContent = radarService.points.length;
    $('#r-anticip', root).textContent = formatDistance(s.alertDistance);
    $('#r-acc', root).textContent = s.accuracy != null ? `± ${Math.round(s.accuracy)} m` : '—';
    const f = s.fetch;
    const parts = [];
    if (s.demo) parts.push('Données simulées du mode démo.');
    else {
      parts.push('Source : OpenStreetMap (ODbL).');
      if (f.loading) parts.push('Chargement des radars…');
      else if (f.at) parts.push(`${f.count} points, ${f.origin === 'cache' ? 'en mémoire' : 'téléchargés'} ${timeAgo(f.at)}.`);
      if (f.error) parts.push(f.error);
    }
    if (radarService.reported.length) parts.push(`${radarService.reported.length} signalement(s) personnel(s).`);
    $('#r-source', root).textContent = parts.join(' ');

    renderList(s, danger);
  }

  function renderList(s, danger) {
    const range = settings.get('range');
    const items = s.threats.filter((t) => t.distance <= range && !(danger && CATEGORIES[t.point.category].road)).slice(0, 15);
    $('#r-near-count', root).textContent = s.pos ? `${items.length} dans ${formatDistance(range)}` : '';
    const list = $('#r-list', root);
    if (!s.pos) {
      list.innerHTML = `<li class="empty">Les radars et caméras proches apparaîtront ici dès que votre position sera connue.</li>`;
      return;
    }
    if (!items.length) {
      list.innerHTML = `<li class="empty">${danger ? 'Mode zones de danger : les positions exactes des radars sont masquées.' : 'Aucun point connu dans ce rayon.'}</li>`;
      return;
    }
    const c = themeColors();
    list.innerHTML = items
      .map((t) => {
        const p = t.point;
        const cat = CATEGORIES[p.category];
        const sub = [p.maxspeed ? `${p.maxspeed} km/h` : null, t.ahead ? 'devant' : 'hors trajectoire', p.detail].filter(Boolean).map(escapeHtml).join(' · ');
        const osm = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lon.toFixed(6)}#map=18/${p.lat.toFixed(6)}/${p.lon.toFixed(6)}`;
        return `<li>
          <span class="kind-badge">${shapeSvg(cat.shape, categoryColor(p.category, c))}</span>
          <div class="grow"><div class="title">${escapeHtml(cat.label)}</div><div class="sub">${sub}</div></div>
          <span class="dist">${formatDistance(t.distance)}</span>
          <span class="arrow" style="transform:rotate(${Math.round(t.relative)}deg)" aria-hidden="true">${icons.arrowUp}</span>
          <a class="icon-btn" href="${osm}" target="_blank" rel="noopener" aria-label="Voir sur la carte OpenStreetMap">${icons.map}</a>
        </li>`;
      })
      .join('');
  }

  $('#r-toggle', root).addEventListener('click', () => {
    if (radarService.state.running) radarService.stop();
    else {
      unlockAudio();
      radarService.start();
    }
  });

  $('#r-report', root).addEventListener('click', () => {
    if (radarService.report()) toast('Radar signalé à votre position. Il sera annoncé pendant 7 jours.');
  });

  $('#r-range', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    settings.set('range', Number(b.dataset.range));
  });

  const onUpdate = () => render();
  const onSettings = (key) => {
    if (key === 'range') {
      renderRange();
      render();
    }
    if (key === 'categories' || key === 'theme') renderLegend();
    if (key === 'dangerZones') render();
  };
  let unsub = null;

  return {
    root,
    mount() {
      scope.instance = createScope($('#r-scope', root), getState);
      scope.instance.start();
      radarService.addEventListener('update', onUpdate);
      unsub = settings.subscribe(onSettings);
      window.addEventListener('sentinelle:theme', renderLegend);
      renderLegend();
      renderRange();
      render();
    },
    unmount() {
      scope.instance?.dispose();
      radarService.removeEventListener('update', onUpdate);
      unsub?.();
      window.removeEventListener('sentinelle:theme', renderLegend);
    },
  };
}
