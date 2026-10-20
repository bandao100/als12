// Pont vers l'application Android : capteurs natifs exposés par la WebView
// (magnétomètre, boussole, Bluetooth, Wi-Fi, synthèse vocale, écran allumé).
const bridge = typeof window !== 'undefined' ? window.SentinelleNative : undefined;

export const isNative = !!bridge;

const pending = new Map();
let seq = 0;

if (isNative) {
  window.__sentinelleNative = {
    resolve(id, json) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      let value = null;
      try {
        value = JSON.parse(json);
      } catch {
        /* réponse illisible */
      }
      if (value?.error) p.reject(new Error(value.error));
      else p.resolve(value);
    },
  };
}

// Appel asynchrone : l'application répond via window.__sentinelleNative.resolve.
export function nativeCall(method, ...args) {
  if (!isNative) return Promise.reject(new Error('Application Android absente'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    bridge.call(method, id, JSON.stringify(args));
  });
}

// Lecture synchrone des mesures à haute fréquence.
export function nativePoll(what) {
  if (!isNative) return null;
  try {
    return JSON.parse(bridge.poll(what));
  } catch {
    return null;
  }
}

let info = null;
export function nativeInfo() {
  if (!isNative) return null;
  if (!info) {
    try {
      info = JSON.parse(bridge.info());
    } catch {
      info = {};
    }
  }
  return info;
}

export function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Annonce BLE native → format attendu par identifyDevice.
export function fromNativeAdvert(d) {
  return {
    id: d.id,
    name: d.name || null,
    rssi: d.rssi,
    txPower: Number.isFinite(d.txPower) ? d.txPower : null,
    manufacturerData: new Map(Object.entries(d.manufacturer || {}).map(([k, v]) => [Number(k), hexToBytes(v)])),
    serviceData: new Map(Object.entries(d.serviceData || {}).map(([k, v]) => [k, hexToBytes(v)])),
    uuids: d.uuids || [],
  };
}
