// Détection des capteurs disponibles et boussole.
import { normalizeAngle } from './geo.js';

export function capabilities() {
  const md = navigator.mediaDevices;
  return {
    secure: window.isSecureContext,
    geolocation: 'geolocation' in navigator,
    camera: !!md?.getUserMedia,
    microphone: !!md?.getUserMedia && !!(window.AudioContext || window.webkitAudioContext),
    magnetometer: 'Magnetometer' in window,
    bluetooth: !!navigator.bluetooth,
    bleScan: !!navigator.bluetooth?.requestLEScan,
    orientation: 'DeviceOrientationEvent' in window,
    vibration: 'vibrate' in navigator,
    wakeLock: 'wakeLock' in navigator,
    speech: 'speechSynthesis' in window,
    ios: /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  };
}

// État d'autorisation sans déclencher de demande, quand le navigateur le permet.
export async function permissionState(name) {
  try {
    const r = await navigator.permissions?.query({ name });
    return r?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Boussole : cap du haut de l'écran, 0 = nord.
export class Compass {
  constructor(onHeading) {
    this.onHeading = onHeading;
    this.heading = null;
    this.handler = (e) => this.read(e);
    this.active = false;
  }

  async start() {
    if (this.active || !('DeviceOrientationEvent' in window)) return false;
    // iOS exige une autorisation explicite, depuis un geste de l'utilisateur.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.active = true;
    const absolute = 'ondeviceorientationabsolute' in window;
    this.eventName = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(this.eventName, this.handler);
    return true;
  }

  read(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute !== false && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h == null) return;
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
    h = normalizeAngle(h + screenAngle);
    // Lissage circulaire pour éviter les sauts de l'aiguille.
    if (this.heading == null) this.heading = h;
    else {
      const d = ((h - this.heading + 540) % 360) - 180;
      this.heading = normalizeAngle(this.heading + d * 0.2);
    }
    this.onHeading?.(this.heading);
  }

  stop() {
    if (!this.active) return;
    window.removeEventListener(this.eventName, this.handler);
    this.active = false;
  }
}
