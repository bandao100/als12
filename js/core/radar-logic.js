// Logique des radars routiers : requête OpenStreetMap, normalisation, calcul des alertes.
import { angleDiff, bearing, distance } from './geo.js';

export const CATEGORIES = {
  fixed: { label: 'Radar fixe', short: 'Fixe', shape: 'triangle', road: true },
  section: { label: 'Radar tronçon', short: 'Tronçon', shape: 'diamond', road: true },
  redlight: { label: 'Radar feu rouge', short: 'Feu rouge', shape: 'square', road: true },
  mobile: { label: 'Radar mobile', short: 'Mobile', shape: 'triangle', road: true },
  reported: { label: 'Signalement', short: 'Signalé', shape: 'star', road: true },
  surveillance: { label: 'Caméra de surveillance', short: 'Vidéo', shape: 'circle', road: false },
};

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export function buildOverpassQuery({ lat, lon }, radius, { surveillanceRadius = 0 } = {}) {
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const r = Math.round(radius);
  const lines = [
    `node["highway"="speed_camera"](around:${r},${at});`,
    `relation["type"="enforcement"](around:${r},${at});`,
  ];
  if (surveillanceRadius > 0) {
    lines.push(`node["man_made"="surveillance"](around:${Math.round(surveillanceRadius)},${at});`);
  }
  return `[out:json][timeout:25];(${lines.join('')});out body;>;out skel qt;`;
}

// "50", "50 mph", "FR:urban", "none"… → km/h ou null.
export function parseMaxspeed(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  const zones = { 'fr:urban': 50, 'fr:rural': 80, 'fr:motorway': 130, 'be:urban': 50, 'ch:urban': 50 };
  if (zones[v]) return zones[v];
  const m = v.match(/^(\d{1,3})(?:\s*(mph|km\/h|kmh))?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  return m[2] === 'mph' ? Math.round(n * 1.609344) : n;
}

function categoryFromEnforcement(tag) {
  switch (tag) {
    case 'maxspeed':
      return 'fixed';
    case 'average_speed':
      return 'section';
    case 'traffic_signals':
      return 'redlight';
    default:
      return null;
  }
}

// Convertit la réponse Overpass en liste de points homogènes.
export function parseOverpass(json) {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      const prev = nodes.get(el.id);
      // "out skel" renvoie le même nœud sans étiquettes : on garde la version la plus riche.
      if (!prev || (!prev.tags && el.tags)) nodes.set(el.id, el);
    }
  }

  const points = new Map();
  for (const n of nodes.values()) {
    const t = n.tags || {};
    let category = null;
    if (t.highway === 'speed_camera') {
      category = t['speed_camera'] === 'mobile' ? 'mobile' : 'fixed';
    } else if (t.man_made === 'surveillance') {
      const kind = t['surveillance:type'];
      if (kind && kind !== 'camera' && kind !== 'ALPR') continue;
      category = 'surveillance';
    }
    if (!category) continue;
    points.set(n.id, {
      id: `osm:n${n.id}`,
      lat: n.lat,
      lon: n.lon,
      category,
      maxspeed: parseMaxspeed(t.maxspeed),
      direction: t.direction ?? t['camera:direction'] ?? null,
      detail: t['surveillance:type'] === 'ALPR' ? 'Lecture de plaques' : t.name || null,
      source: 'osm',
    });
  }

  for (const rel of elements) {
    if (rel.type !== 'relation' || rel.tags?.type !== 'enforcement') continue;
    const category = categoryFromEnforcement(rel.tags.enforcement);
    if (!category) continue;
    const devices = (rel.members || []).filter((m) => m.type === 'node' && m.role === 'device');
    for (const m of devices) {
      const n = nodes.get(m.ref);
      if (!n) continue;
      const prev = points.get(n.id);
      points.set(n.id, {
        id: `osm:n${n.id}`,
        lat: n.lat,
        lon: n.lon,
        category: prev && prev.category !== 'fixed' ? prev.category : category,
        maxspeed: parseMaxspeed(rel.tags.maxspeed) ?? prev?.maxspeed ?? null,
        direction: prev?.direction ?? null,
        detail: rel.tags.name || prev?.detail || null,
        source: 'osm',
      });
    }
  }
  return [...points.values()];
}

// Distance d'anticipation : on veut ~lookAhead secondes de préavis.
export function alertDistanceFor(speedKmh, { lookAhead = 30, min = 400, max = 2000 } = {}) {
  const v = Math.max(0, speedKmh || 0) / 3.6;
  return Math.min(max, Math.max(min, v * lookAhead));
}

// Classe chaque point par rapport à la position et au cap courants.
export function computeThreats(points, pos, { heading = null, cone = 35, enabled = null } = {}) {
  if (!pos) return [];
  const out = [];
  for (const p of points) {
    if (enabled && !enabled[p.category]) continue;
    const d = distance(pos, p);
    const b = bearing(pos, p);
    const rel = heading == null ? 0 : angleDiff(heading, b);
    // Très près, le cap est imprécis : on élargit le cône.
    const tolerance = d < 120 ? 80 : cone;
    out.push({ point: p, distance: d, bearing: b, relative: rel, ahead: heading == null || Math.abs(rel) <= tolerance });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

export function pickAlert(threats, alertDistance) {
  return (
    threats.find((t) => t.ahead && CATEGORIES[t.point.category]?.road && t.distance <= alertDistance) || null
  );
}

export function alertLevel(d, alertDistance) {
  if (d <= Math.min(250, alertDistance * 0.3)) return 'imminent';
  if (d <= alertDistance * 0.6) return 'near';
  return 'far';
}

// Mémorise les annonces pour ne pas répéter la même alerte vocale.
export class AlertTracker {
  constructor() {
    this.currentId = null;
    this.level = null;
    this.done = new Map();
  }

  // Renvoie la liste des évènements à annoncer : enter, escalate, exit.
  update(alert, alertDistance, now = Date.now()) {
    const events = [];
    for (const [id, t] of this.done) if (now - t > 10 * 60 * 1000) this.done.delete(id);

    if (!alert) {
      if (this.currentId) {
        events.push({ type: 'exit', id: this.currentId });
        this.done.set(this.currentId, now);
      }
      this.currentId = null;
      this.level = null;
      return events;
    }
    const id = alert.point.id;
    const level = alertLevel(alert.distance, alertDistance);
    if (id !== this.currentId) {
      if (this.currentId) {
        events.push({ type: 'exit', id: this.currentId });
        this.done.set(this.currentId, now);
      }
      this.currentId = id;
      this.level = level;
      if (!this.done.has(id)) events.push({ type: 'enter', id, level });
      return events;
    }
    const rank = { far: 0, near: 1, imminent: 2 };
    if (rank[level] > rank[this.level]) {
      events.push({ type: 'escalate', id, level });
      this.level = level;
    }
    return events;
  }
}

// Estime cap et vitesse à partir de deux positions GPS successives.
export function motionFrom(prev, next) {
  if (!prev || !next) return null;
  const dt = (next.t - prev.t) / 1000;
  if (dt <= 0) return null;
  const d = distance(prev, next);
  if (d < 8) return { speed: d / dt, heading: null };
  return { speed: d / dt, heading: bearing(prev, next) };
}
