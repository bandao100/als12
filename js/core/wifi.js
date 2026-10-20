// Analyse des réseaux Wi-Fi alentour : repère les points d'accès de caméras
// (réseau de configuration diffusé par la caméra) et les puces d'objets connectés.

// Noms de réseau typiques des caméras IP et mini-caméras espion.
const CAMERA_SSID = [
  /(^|[^a-z])(ip-?cam|ipc|cam|camera|dvr|nvr|spy)([^a-z]|$)/i,
  /hikvision|ezviz|dahua|imou|tapo[_ -]?c|wansview|reolink|wyze|eufy|blink|arlo|lookcam|hdwificam|jxlcam|icsee|xmeye|camhi|ycc365|carecam|cloudedge|v380|mvcam|pv-?cam/i,
  /^(hd|mv|xm|ja|a9)[-_ ]?[0-9a-f]{4,}$/i,
];

// Préfixes d'adresse matérielle (OUI) de fabricants de caméras et de puces.
export const OUI_VENDORS = {
  '44:19:b6': ['Hikvision', 'camera'],
  '4c:bd:8f': ['Hikvision', 'camera'],
  'bc:ad:28': ['Hikvision', 'camera'],
  'c0:56:e3': ['Hikvision', 'camera'],
  '28:57:be': ['Hikvision', 'camera'],
  '54:c4:15': ['Hikvision', 'camera'],
  'c4:2f:90': ['Hikvision', 'camera'],
  'a4:14:37': ['Hikvision', 'camera'],
  '3c:ef:8c': ['Dahua', 'camera'],
  '90:02:a9': ['Dahua', 'camera'],
  'e0:50:8b': ['Dahua', 'camera'],
  '4c:11:bf': ['Dahua', 'camera'],
  '2c:aa:8e': ['Wyze', 'camera'],
  'ec:71:db': ['Reolink', 'camera'],
  '24:0a:c4': ['Espressif', 'iot'],
  '24:6f:28': ['Espressif', 'iot'],
  '24:62:ab': ['Espressif', 'iot'],
  '30:ae:a4': ['Espressif', 'iot'],
  '3c:71:bf': ['Espressif', 'iot'],
  '5c:cf:7f': ['Espressif', 'iot'],
  '18:fe:34': ['Espressif', 'iot'],
  '60:01:94': ['Espressif', 'iot'],
  '84:cc:a8': ['Espressif', 'iot'],
  '84:f3:eb': ['Espressif', 'iot'],
  'a4:cf:12': ['Espressif', 'iot'],
  'ac:67:b2': ['Espressif', 'iot'],
  'bc:dd:c2': ['Espressif', 'iot'],
  'c4:4f:33': ['Espressif', 'iot'],
  'cc:50:e3': ['Espressif', 'iot'],
  'dc:4f:22': ['Espressif', 'iot'],
  'ec:fa:bc': ['Espressif', 'iot'],
};

export function normalizeMac(mac) {
  return String(mac || '').trim().toLowerCase().replace(/-/g, ':');
}

// Bit « administré localement » : adresse aléatoire, le fabricant n'est pas identifiable.
export function isRandomMac(mac) {
  const first = parseInt(normalizeMac(mac).slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) === 0x02;
}

export function band(freq) {
  if (freq >= 5925) return '6 GHz';
  if (freq >= 4900) return '5 GHz';
  return '2,4 GHz';
}

export function channel(freq) {
  if (freq === 2484) return 14;
  if (freq >= 2412 && freq < 2484) return (freq - 2407) / 5;
  if (freq >= 5925) return (freq - 5950) / 5;
  if (freq >= 4900) return (freq - 5000) / 5;
  return null;
}

export function security(capabilities = '') {
  const c = capabilities.toUpperCase();
  if (c.includes('WPA3') || c.includes('SAE')) return 'WPA3';
  if (c.includes('WPA2') || c.includes('RSN')) return 'WPA2';
  if (c.includes('WPA')) return 'WPA';
  if (c.includes('WEP')) return 'WEP';
  return 'Ouvert';
}

export function signalLabel(level) {
  if (level >= -50) return 'Très proche';
  if (level >= -65) return 'Proche';
  if (level >= -80) return 'Moyen';
  return 'Lointain';
}

export function identifyNetwork(n = {}) {
  const ssid = (n.ssid || '').replace(/^"|"$/g, '');
  const mac = normalizeMac(n.bssid);
  const vendor = isRandomMac(mac) ? null : OUI_VENDORS[mac.slice(0, 8)] || null;
  const reasons = [];
  let kind = 'router';
  if (ssid && CAMERA_SSID.some((re) => re.test(ssid))) {
    kind = 'camera';
    reasons.push('nom typique de caméra');
  }
  if (vendor?.[1] === 'camera') {
    kind = 'camera';
    reasons.push(`matériel ${vendor[0]}`);
  } else if (vendor?.[1] === 'iot') {
    if (kind !== 'camera') kind = 'iot';
    reasons.push(`puce ${vendor[0]} (objets connectés, mini-caméras)`);
  }
  if (!ssid) {
    if (kind === 'router') kind = 'hidden';
    reasons.push('réseau masqué');
  }
  const risk = kind === 'camera' ? 'high' : kind === 'iot' || kind === 'hidden' ? 'medium' : 'low';
  const label = { camera: 'Caméra possible', iot: 'Objet connecté', hidden: 'Réseau masqué', router: 'Point d’accès' }[kind];
  return { ssid, label, kind, risk, vendor: vendor?.[0] || null, reasons, random: isRandomMac(mac) };
}

// Trie : risque d'abord, puis signal le plus fort.
export function rankNetworks(list) {
  const order = { high: 0, medium: 1, low: 2 };
  return list
    .map((n) => ({ ...n, info: identifyNetwork(n) }))
    .sort((a, b) => order[a.info.risk] - order[b.info.risk] || b.level - a.level);
}
