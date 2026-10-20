// Identification des appareils Bluetooth Low Energy à partir de leurs annonces.

// Identifiants d'entreprise attribués par le Bluetooth SIG.
export const COMPANIES = {
  0x0002: 'Intel',
  0x0006: 'Microsoft',
  0x000a: 'Qualcomm',
  0x000f: 'Broadcom',
  0x001d: 'Qualcomm',
  0x004c: 'Apple',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung',
  0x0087: 'Garmin',
  0x00e0: 'Google',
  0x0157: 'Huami (Amazfit)',
  0x0171: 'Amazon',
  0x027d: 'Huawei',
  0x038f: 'Xiaomi',
  0x0499: 'Ruuvi',
};

// Services 16 bits courants.
export const SERVICES = {
  0xfd5a: { label: 'Samsung SmartTag', kind: 'tracker' },
  0xfeed: { label: 'Traceur Tile', kind: 'tracker' },
  0xfeec: { label: 'Traceur Tile', kind: 'tracker' },
  0xfe2c: { label: 'Accessoire Google Fast Pair', kind: 'audio' },
  0xfd6f: { label: "Notification d'exposition", kind: 'phone' },
  0xfeaa: { label: 'Balise Eddystone', kind: 'beacon' },
  0x180d: { label: 'Capteur cardiaque', kind: 'wearable' },
  0x1812: { label: 'Clavier ou souris', kind: 'hid' },
  0x181a: { label: "Capteur d'environnement", kind: 'sensor' },
  0x1803: { label: 'Appareil connecté', kind: 'other' },
};

export const KINDS = {
  tracker: { label: 'Traceur', risk: 'high' },
  camera: { label: 'Caméra possible', risk: 'high' },
  beacon: { label: 'Balise', risk: 'medium' },
  phone: { label: 'Téléphone', risk: 'low' },
  audio: { label: 'Audio', risk: 'low' },
  wearable: { label: 'Objet porté', risk: 'low' },
  hid: { label: 'Périphérique', risk: 'low' },
  sensor: { label: 'Capteur', risk: 'low' },
  computer: { label: 'Ordinateur', risk: 'low' },
  other: { label: 'Appareil', risk: 'low' },
};

// "0000feed-0000-1000-8000-00805f9b34fb" → 0xfeed ; null pour un UUID 128 bits propriétaire.
export function shortUuid(uuid) {
  if (typeof uuid === 'number') return uuid;
  const s = String(uuid).toLowerCase();
  const m = s.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  if (m) return parseInt(m[1], 16);
  if (/^(0x)?[0-9a-f]{4}$/.test(s)) return parseInt(s.replace('0x', ''), 16);
  return null;
}

function bytes(v) {
  if (!v) return new Uint8Array(0);
  if (v instanceof Uint8Array) return v;
  if (v instanceof DataView) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  return new Uint8Array(v);
}

const APPLE_TYPES = {
  0x02: { label: 'Balise iBeacon', kind: 'beacon' },
  0x05: { label: 'Appareil Apple (AirDrop)', kind: 'phone' },
  0x07: { label: 'AirPods / Beats', kind: 'audio' },
  0x09: { label: 'Récepteur AirPlay', kind: 'other' },
  0x0c: { label: 'Appareil Apple (Handoff)', kind: 'phone' },
  0x10: { label: 'Appareil Apple', kind: 'phone' },
  0x12: { label: 'Réseau Localiser (AirTag ou appareil Apple)', kind: 'tracker' },
};

const NAME_HINTS = [
  { re: /\b(cam|ipc|spy|dvr|wifi ?cam|hd ?cam|mini ?cam)/i, label: 'Caméra possible', kind: 'camera' },
  { re: /airtag|smarttag|tile|chipolo|nut ?find|itag/i, label: 'Traceur', kind: 'tracker' },
  { re: /buds|airpods|jbl|bose|sony wh|headset|écouteur/i, label: 'Audio', kind: 'audio' },
  { re: /watch|band|fitbit|garmin|amazfit/i, label: 'Montre ou bracelet', kind: 'wearable' },
  { re: /iphone|galaxy|pixel|redmi|phone/i, label: 'Téléphone', kind: 'phone' },
  { re: /macbook|laptop|\bpc\b|desktop/i, label: 'Ordinateur', kind: 'computer' },
];

// adv = { name, manufacturerData: Map<number, bytes>, serviceData: Map<uuid, bytes>, uuids: string[] }
export function identifyDevice(adv = {}) {
  const manufacturer = adv.manufacturerData instanceof Map ? adv.manufacturerData : new Map(Object.entries(adv.manufacturerData || {}).map(([k, v]) => [Number(k), v]));
  const serviceData = adv.serviceData instanceof Map ? adv.serviceData : new Map(Object.entries(adv.serviceData || {}));
  const services = new Set();
  for (const u of adv.uuids || []) {
    const s = shortUuid(u);
    if (s != null) services.add(s);
  }
  for (const u of serviceData.keys()) {
    const s = shortUuid(u);
    if (s != null) services.add(s);
  }

  let vendor = null;
  let result = null;
  for (const [company, data] of manufacturer) {
    vendor = vendor || COMPANIES[company] || `Fabricant 0x${company.toString(16).padStart(4, '0')}`;
    if (company === 0x004c) {
      const b = bytes(data);
      const type = APPLE_TYPES[b[0]];
      if (type) result = { ...type };
    }
  }

  // Google Find My Device : Eddystone avec trames 0x40/0x41.
  for (const [u, data] of serviceData) {
    if (shortUuid(u) === 0xfeaa) {
      const b = bytes(data);
      if (b[0] === 0x40 || b[0] === 0x41) result = { label: 'Réseau Localiser Google (traceur)', kind: 'tracker' };
    }
  }

  if (!result || result.kind !== 'tracker') {
    for (const s of services) {
      const svc = SERVICES[s];
      if (svc && (!result || svc.kind === 'tracker')) {
        result = { ...svc };
        if (svc.kind === 'tracker') break;
      }
    }
  }

  if (adv.name) {
    for (const h of NAME_HINTS) {
      if (h.re.test(adv.name) && (!result || h.kind === 'camera' || (h.kind === 'tracker' && result.kind !== 'tracker'))) {
        result = { label: h.label, kind: h.kind };
        break;
      }
    }
  }

  result = result || { label: vendor ? `Appareil ${vendor}` : 'Appareil inconnu', kind: 'other' };
  return { ...result, vendor, risk: KINDS[result.kind]?.risk || 'low', services: [...services] };
}

// Modèle log-distance : d = 10^((P1m - RSSI) / (10·n)).
// txPower est la puissance d'émission annoncée ; à 1 m on reçoit environ 41 dB de moins.
export function estimateDistance(rssi, txPower = null, n = 2.2) {
  if (!Number.isFinite(rssi)) return null;
  const ref = Number.isFinite(txPower) ? Math.min(-30, Math.max(-80, txPower - 41)) : -59;
  return Math.min(80, Math.max(0.1, 10 ** ((ref - rssi) / (10 * n))));
}

export function proximityLabel(meters) {
  if (meters == null) return '—';
  if (meters < 1) return 'Tout près';
  if (meters < 3) return 'Proche';
  if (meters < 10) return 'Dans la pièce';
  return 'Éloigné';
}

// Filtre de Kalman 1D : lisse le RSSI, très bruité.
export class RssiFilter {
  constructor({ q = 0.08, r = 4 } = {}) {
    this.q = q;
    this.r = r;
    this.x = null;
    this.p = 1;
  }

  update(z) {
    if (!Number.isFinite(z)) return this.x;
    if (this.x == null) {
      this.x = z;
      return z;
    }
    this.p += this.q;
    const k = this.p / (this.p + this.r);
    this.x += k * (z - this.x);
    this.p *= 1 - k;
    return this.x;
  }
}

// RSSI → 0..1 pour les jauges (‑100 dBm = 0, ‑35 dBm = 1).
export function rssiToLevel(rssi) {
  if (!Number.isFinite(rssi)) return 0;
  return Math.min(1, Math.max(0, (rssi + 100) / 65));
}
