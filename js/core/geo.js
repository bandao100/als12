// Géodésie sur courtes distances : tout est en mètres et en degrés.

export const EARTH_RADIUS = 6371008.8;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

// Écart signé de a vers b, dans [-180, 180).
export function angleDiff(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

// Distance orthodromique (formule de haversine).
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Cap initial de a vers b, 0 = nord, sens horaire.
export function bearing(a, b) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeAngle(toDeg(Math.atan2(y, x)));
}

// Projection locale équirectangulaire : x vers l'est, y vers le nord.
export function toLocalXY(origin, p) {
  const meanLat = toRad((origin.lat + p.lat) / 2);
  return {
    x: toRad(p.lon - origin.lon) * Math.cos(meanLat) * EARTH_RADIUS,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS,
  };
}

export function offset(origin, dx, dy) {
  const lat = origin.lat + toDeg(dy / EARTH_RADIUS);
  const lon = origin.lon + toDeg(dx / (EARTH_RADIUS * Math.cos(toRad(origin.lat))));
  return { lat, lon };
}

// Point atteint en partant de origin sur un cap donné.
export function destination(origin, headingDeg, meters) {
  const h = toRad(headingDeg);
  return offset(origin, Math.sin(h) * meters, Math.cos(h) * meters);
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) {
    const step = m < 100 ? 5 : 10;
    return `${nf0.format(Math.round(m / step) * step)} m`;
  }
  if (m < 10000) return `${nf1.format(m / 1000)} km`;
  return `${nf0.format(m / 1000)} km`;
}

// Distance parlée pour la synthèse vocale.
export function spokenDistance(m) {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} mètres`;
  const km = Math.round(m / 100) / 10;
  return `${String(km).replace('.', ',')} kilomètre${km >= 2 ? 's' : ''}`;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
export function cardinal(deg) {
  return CARDINALS[Math.round(normalizeAngle(deg) / 45) % 8];
}
