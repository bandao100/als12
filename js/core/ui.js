// Petits utilitaires d'interface : échappement, toasts, canvas net, couleurs du thème.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastHost = null;
export function toast(message, { tone = 'info', timeout = 3200 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.append(toastHost);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.dataset.tone = tone;
  t.textContent = message;
  toastHost.append(t);
  setTimeout(() => t.remove(), timeout);
}

// Canvas à la résolution de l'écran ; rappelle onResize avec la taille CSS.
export function hiDpiCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  const state = { ctx, width: 0, height: 0, dpr: 1 };
  const apply = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (!r.width || !r.height) return;
    state.width = r.width;
    state.height = r.height;
    state.dpr = dpr;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(state);
  };
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  apply();
  state.dispose = () => ro.disconnect();
  return state;
}

// Couleurs du thème lues depuis les variables CSS, pour le dessin sur canvas.
let palette = null;
export function themeColors() {
  if (palette) return palette;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  palette = {
    bg: v('--bg'),
    panel: v('--panel'),
    raise: v('--raise'),
    line: v('--line'),
    fg: v('--fg'),
    muted: v('--muted'),
    accent: v('--accent'),
    ok: v('--ok'),
    warn: v('--warn'),
    danger: v('--danger'),
    report: v('--report'),
    scopeBg: v('--scope-bg'),
    scopeRing: v('--scope-ring'),
    scopeText: v('--scope-text'),
    scopeSweep: v('--scope-sweep'),
    mono: v('--font-mono'),
    display: v('--font-display'),
  };
  return palette;
}

export function invalidateTheme() {
  palette = null;
  window.dispatchEvent(new Event('sentinelle:theme'));
}

// Maintient l'écran allumé pendant la surveillance.
export function createWakeLock() {
  let lock = null;
  let wanted = false;
  const acquire = async () => {
    if (!wanted || lock || !('wakeLock' in navigator) || document.hidden) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } catch {
      lock = null;
    }
  };
  document.addEventListener('visibilitychange', acquire);
  return {
    async on() {
      wanted = true;
      await acquire();
    },
    off() {
      wanted = false;
      lock?.release().catch(() => {});
      lock = null;
    },
  };
}

// Boucle d'animation qui s'interrompt quand l'onglet est masqué.
export function animationLoop(draw) {
  let id = 0;
  let running = false;
  const frame = (t) => {
    if (!running) return;
    draw(t);
    id = requestAnimationFrame(frame);
  };
  return {
    start() {
      if (running) return;
      running = true;
      id = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(id);
    },
    get running() {
      return running;
    },
  };
}

export const nf = (digits = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function timeAgo(ts) {
  if (!ts) return 'jamais';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
