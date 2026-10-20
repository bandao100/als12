// Réglages et petites données persistées dans le navigateur.
// Le stockage peut être indisponible (navigation privée, aperçu) : tout passe par try/catch.

const KEY = 'sentinelle:settings:v1';

export const DEFAULTS = {
  theme: 'auto',
  voice: true,
  sound: true,
  vibrate: true,
  dangerZones: false,
  lookAhead: 30,
  range: 2000,
  sensitivity: 0.6,
  demo: false,
  categories: { fixed: true, section: true, redlight: true, mobile: true, reported: true, surveillance: false },
};

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function load() {
  const saved = readJSON(KEY, {});
  return { ...DEFAULTS, ...saved, categories: { ...DEFAULTS.categories, ...(saved.categories || {}) } };
}

const state = load();
const listeners = new Set();

export const settings = {
  get(key) {
    return state[key];
  },
  set(key, value) {
    state[key] = value;
    writeJSON(KEY, state);
    for (const fn of listeners) fn(key, value);
  },
  setCategory(cat, on) {
    this.set('categories', { ...state.categories, [cat]: on });
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
