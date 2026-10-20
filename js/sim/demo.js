// Sources simulées du mode démonstration. Toutes les données affichées
// dans ce mode sont fictives et signalées comme telles à l'écran.
import { destination, offset } from '../core/geo.js';
import { frequencyBin } from '../core/spectrum.js';

export const DEMO_CENTER = { lat: 48.8462, lon: 2.3371 };

// Trajet circulaire de 1,4 km de rayon parcouru dans le sens horaire.
export function createDemoDrive(center = DEMO_CENTER) {
  const R = 1400;
  const onRoute = (deg, extra) => ({ ...offset(center, R * Math.sin((deg * Math.PI) / 180), R * Math.cos((deg * Math.PI) / 180)), ...extra });
  const points = [
    onRoute(38, { id: 'demo:1', category: 'fixed', maxspeed: 70 }),
    onRoute(118, { id: 'demo:2', category: 'redlight', maxspeed: 50 }),
    onRoute(205, { id: 'demo:3', category: 'section', maxspeed: 90 }),
    onRoute(290, { id: 'demo:4', category: 'fixed', maxspeed: 80 }),
    { id: 'demo:5', category: 'surveillance', ...destination(center, 60, 600) },
    { id: 'demo:6', category: 'surveillance', ...destination(center, 200, 900) },
    { id: 'demo:7', category: 'fixed', maxspeed: 50, ...destination(center, 330, 400) },
    { id: 'demo:8', category: 'surveillance', ...destination(center, 140, 1900) },
  ].map((p) => ({ source: 'demo', direction: null, detail: null, ...p }));

  let s = (14 * Math.PI * R) / 180; // départ à 14°, ~600 m avant le premier radar
  let last = null;
  return {
    points,
    tick(now) {
      const dt = last == null ? 0 : Math.min(1, (now - last) / 1000);
      last = now;
      const speed = 22 + Math.sin(now / 9000) * 4.5 + Math.sin(now / 2300) * 1.2; // m/s
      s += speed * dt;
      const theta = s / R;
      const pos = offset(center, R * Math.sin(theta), R * Math.cos(theta));
      return { ...pos, speed, heading: ((theta * 180) / Math.PI + 90) % 360, accuracy: 6, t: now };
    },
  };
}

// Magnétomètre : champ terrestre ~47 µT, avec un « appareil » approché toutes les 14 s.
export function createDemoMagnetometer() {
  const t0 = performance.now();
  return () => {
    const t = (performance.now() - t0) / 1000;
    const cycle = t % 14;
    const bump = cycle > 6 && cycle < 11 ? Math.sin(((cycle - 6) / 5) * Math.PI) ** 2 * 140 : 0;
    const n = () => (Math.random() - 0.5) * 1.6;
    return { x: 18 + n() + bump * 0.6, y: -26 + n() + bump * 0.2, z: 34 + n() + bump * 0.75 };
  };
}

// Annonces Bluetooth fictives, dont un traceur qui « s'approche ».
export function createDemoBluetooth() {
  const t0 = performance.now();
  const devices = [
    { id: 'd1', name: null, manufacturerData: new Map([[0x004c, Uint8Array.from([0x12, 0x19, 0x10])]]), base: -71, swing: 14, period: 18 },
    { id: 'd2', name: 'Galaxy Buds2', serviceData: new Map([['0000fe2c-0000-1000-8000-00805f9b34fb', Uint8Array.from([0])]]), base: -58, swing: 4, period: 7 },
    { id: 'd3', name: null, uuids: ['0000fd5a-0000-1000-8000-00805f9b34fb'], base: -83, swing: 5, period: 11 },
    { id: 'd4', name: 'Forerunner 255', manufacturerData: new Map([[0x0087, Uint8Array.from([1, 2])]]), base: -66, swing: 3, period: 9 },
    { id: 'd5', name: 'IPC-Cam 1080P', manufacturerData: new Map([[0x0059, Uint8Array.from([4])]]), base: -77, swing: 6, period: 13 },
    { id: 'd6', name: null, manufacturerData: new Map([[0x004c, Uint8Array.from([0x10, 0x05])]]), base: -62, swing: 5, period: 6 },
    { id: 'd7', name: 'MX Keys', uuids: ['00001812-0000-1000-8000-00805f9b34fb'], base: -74, swing: 3, period: 15 },
  ];
  return () => {
    const t = (performance.now() - t0) / 1000;
    return devices.map((d) => ({
      ...d,
      rssi: Math.round(d.base + Math.sin((t / d.period) * Math.PI * 2) * d.swing + (Math.random() - 0.5) * 6),
      txPower: null,
    }));
  };
}

// Spectre audio fictif : bruit rose + tonalité ultrasonore intermittente à 19,5 kHz.
export function createDemoSpectrum(sampleRate = 48000, fftSize = 4096) {
  const db = new Float32Array(fftSize / 2);
  const t0 = performance.now();
  const tone = frequencyBin(19500, sampleRate, fftSize);
  const whine = frequencyBin(15700, sampleRate, fftSize);
  return () => {
    const t = (performance.now() - t0) / 1000;
    for (let i = 1; i < db.length; i++) {
      const f = (i * sampleRate) / fftSize;
      db[i] = -66 - 14 * Math.log10(f / 100 + 1) - (f > 20500 ? 10 : 0) + (Math.random() - 0.5) * 7;
    }
    if (t % 10 < 7) {
      db[tone - 1] = -66;
      db[tone] = -52 + Math.random() * 2;
      db[tone + 1] = -66;
    }
    db[whine] = -74;
    db[0] = -50;
    return { db, sampleRate, fftSize };
  };
}

// Image synthétique d'une chambre sombre avec un détecteur de fumée piégé.
// torch = false simule la lampe coupée : le reflet de l'objectif disparaît, la lampe de chevet reste.
export function drawDemoRoom(ctx, w, h, t, { torch = true } = {}) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1b1f27');
  g.addColorStop(1, '#0c0e12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Mur et plafond.
  ctx.fillStyle = '#20252e';
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  // Cadre au mur.
  ctx.strokeStyle = '#3a3226';
  ctx.lineWidth = w * 0.02;
  ctx.strokeRect(w * 0.08, h * 0.2, w * 0.28, h * 0.22);
  // Lampe de chevet allumée (grosse source lumineuse : doit être ignorée).
  const lamp = ctx.createRadialGradient(w * 0.82, h * 0.58, 2, w * 0.82, h * 0.58, w * 0.14);
  lamp.addColorStop(0, '#fff8e0');
  lamp.addColorStop(0.35, '#f5d488');
  lamp.addColorStop(1, 'rgba(245,212,136,0)');
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(w * 0.82, h * 0.58, w * 0.14, 0, Math.PI * 2);
  ctx.fill();
  // Détecteur de fumée.
  const jx = Math.sin(t / 700) * w * 0.006;
  const jy = Math.cos(t / 900) * h * 0.004;
  const cx = w * 0.56 + jx;
  const cy = h * 0.16 + jy;
  ctx.fillStyle = '#cfd3d8';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.09, h * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa0a8';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.05, h * 0.024, 0, 0, Math.PI * 2);
  ctx.fill();
  // Objectif : minuscule reflet très brillant au centre.
  ctx.fillStyle = '#202024';
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.012, 0, Math.PI * 2);
  ctx.fill();
  if (!torch) return;
  ctx.fillStyle = '#f4f8ff';
  ctx.beginPath();
  ctx.arc(cx + w * 0.002, cy - h * 0.001, Math.max(1.2, w * 0.0045), 0, Math.PI * 2);
  ctx.fill();
}

// Vue infrarouge : caméra de vision nocturne entourée de LED violettes dans le noir.
export function drawDemoIr(ctx, w, h, t) {
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, w, h);
  const noise = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.7);
  noise.addColorStop(0, '#15121a');
  noise.addColorStop(1, '#060608');
  ctx.fillStyle = noise;
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.38 + Math.sin(t / 800) * w * 0.005;
  const cy = h * 0.3 + Math.cos(t / 1000) * h * 0.004;
  ctx.fillStyle = '#121216';
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.06, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * w * 0.04;
    const y = cy + Math.sin(a) * w * 0.04;
    ctx.fillStyle = '#e9c8ff';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.4, w * 0.006), 0, Math.PI * 2);
    ctx.fill();
  }
}
