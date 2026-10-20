// Point d'entrée : navigation entre écrans, thème, mode démo, installation.
import { icons } from './core/icons.js';
import { settings } from './core/store.js';
import { $, invalidateTheme } from './core/ui.js';
import { cameraScreen } from './screens/camera.js';
import { emfScreen } from './screens/emf.js';
import { homeScreen } from './screens/home.js';
import { radarsScreen } from './screens/radars.js';
import { settingsScreen } from './screens/settings.js';
import { wavesScreen } from './screens/waves.js';
import { radarService } from './services/radar-service.js';

const ROUTES = {
  accueil: { make: homeScreen, label: 'Accueil', icon: icons.home, tab: true },
  radars: { make: radarsScreen, label: 'Radars', icon: icons.radar, tab: true },
  cameras: { make: cameraScreen, label: 'Caméras', icon: icons.camera, tab: true },
  champs: { make: emfScreen, label: 'Champs', icon: icons.magnet, tab: true },
  ondes: { make: wavesScreen, label: 'Ondes', icon: icons.waves, tab: true },
  reglages: { make: settingsScreen, label: 'Réglages', icon: icons.settings, tab: false },
};

let deferredInstall = null;
const ctx = { installPrompt: () => deferredInstall };
const instances = {};
let current = null;
const view = $('#view');

function renderTabs() {
  $('#tabs').innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => r.tab)
    .map(([id, r]) => `<a class="tab" href="#${id}" data-route="${id}">${r.icon}<span>${r.label}</span></a>`)
    .join('');
  $('#settings-link').innerHTML = icons.settings;
}

function navigate(id) {
  if (!ROUTES[id]) id = 'accueil';
  if (current?.id === id) return;
  current?.inst.unmount();
  const inst = (instances[id] ||= ROUTES[id].make(ctx));
  view.replaceChildren(inst.root);
  view.scrollTop = 0;
  inst.mount();
  current = { id, inst };
  document.querySelectorAll('[data-route]').forEach((a) => a.toggleAttribute('aria-current', false));
  document.querySelectorAll(`[data-route="${id}"]`).forEach((a) => a.setAttribute('aria-current', 'page'));
  $('#settings-link').setAttribute('aria-pressed', String(id === 'reglages'));
  updateBadges();
}

// Remonte le contenu de l'écran courant (après bascule du mode démo).
function remount() {
  if (!current) return;
  const { id } = current;
  current.inst.unmount();
  delete instances[id];
  current = null;
  navigate(id);
}

// On ne retire l'attribut que si l'application l'a posé : une page hôte peut aussi le fixer.
let themeOwned = false;
function applyTheme() {
  const t = settings.get('theme');
  if (t !== 'auto') {
    document.documentElement.setAttribute('data-theme', t);
    themeOwned = true;
  } else if (themeOwned) {
    document.documentElement.removeAttribute('data-theme');
    themeOwned = false;
  }
  invalidateTheme();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
}

function renderDemoBanner() {
  $('#demo-banner').hidden = !settings.get('demo');
}

function updateBadges() {
  const s = radarService.state;
  const tab = document.querySelector('.tab[data-route="radars"]');
  if (tab) {
    let badge = tab.querySelector('.tab-badge');
    const show = !!s.alert && current?.id !== 'radars';
    if (show && !badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tab.append(badge);
    } else if (!show && badge) badge.remove();
  }
  const dot = $('#gps-dot');
  dot.dataset.tone = !s.running ? '' : s.status === 'error' ? 'danger' : s.status === 'tracking' ? 'ok' : 'warn';
  dot.title = !s.running ? 'Surveillance radar à l’arrêt' : s.status === 'tracking' ? 'GPS actif' : s.status === 'error' ? 'GPS en erreur' : 'Recherche GPS';
}

function boot() {
  // Version intégrée (aperçu) : les capteurs y sont inaccessibles, on démarre en démo.
  if (window.SENTINELLE_DEMO === true && !settings.get('demo')) settings.set('demo', true);
  renderTabs();
  applyTheme();
  renderDemoBanner();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.get('theme') === 'auto' && applyTheme());
  new MutationObserver(invalidateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  settings.subscribe((key) => {
    if (key === 'theme') applyTheme();
    if (key === 'demo') {
      radarService.stop();
      renderDemoBanner();
      for (const id of Object.keys(instances)) if (id !== current?.id && id !== 'reglages') delete instances[id];
      if (current?.id !== 'reglages') remount();
    }
  });
  $('#demo-exit').addEventListener('click', () => settings.set('demo', false));
  radarService.addEventListener('update', updateBadges);

  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1) || 'accueil');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
  });

  if ('serviceWorker' in navigator && window.isSecureContext && !window.SENTINELLE_DEMO) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
