// Magnétomètre : champ total, écart à la référence, niveaux.
// Le champ terrestre vaut 25 à 65 µT selon le lieu ; on mesure l'écart.

export function magnitude(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

export const LEVELS = [
  { key: 'calm', max: 5, label: 'Calme', hint: 'Aucune source proche' },
  { key: 'low', max: 15, label: 'Faible', hint: 'Objet métallique ou appareil éloigné' },
  { key: 'moderate', max: 40, label: 'Modéré', hint: 'Électronique ou aimant à proximité' },
  { key: 'high', max: 100, label: 'Fort', hint: 'Source très proche : inspectez cet endroit' },
  { key: 'intense', max: Infinity, label: 'Intense', hint: 'Aimant, haut-parleur ou transformateur' },
];

export function emfLevel(delta) {
  const d = Math.abs(delta);
  return LEVELS.find((l) => d < l.max) || LEVELS[LEVELS.length - 1];
}

export class EmfMeter {
  constructor({ alpha = 0.25, historySize = 300 } = {}) {
    this.alpha = alpha;
    this.historySize = historySize;
    this.baseline = null;
    this.smoothed = null;
    this.peak = 0;
    this.history = [];
    this.calibrating = null;
    this.last = { x: 0, y: 0, z: 0 };
  }

  update(x, y, z, t = Date.now()) {
    const total = magnitude(x, y, z);
    if (!Number.isFinite(total)) return null;
    this.last = { x, y, z };
    this.smoothed = this.smoothed == null ? total : this.smoothed + (total - this.smoothed) * this.alpha;
    // Référence provisoire dès la première mesure, affinée par le calibrage.
    if (this.baseline == null) this.baseline = total;
    if (this.calibrating) {
      this.calibrating.push(total);
      if (this.calibrating.length >= 30) {
        const sorted = [...this.calibrating].sort((a, b) => a - b);
        this.baseline = sorted[sorted.length >> 1];
        this.calibrating = null;
        this.peak = 0;
      }
    }
    const delta = this.smoothed - this.baseline;
    if (Math.abs(delta) > Math.abs(this.peak)) this.peak = delta;
    this.history.push({ t, total: this.smoothed, delta });
    if (this.history.length > this.historySize) this.history.shift();
    return { total, smoothed: this.smoothed, delta, peak: this.peak, level: emfLevel(delta) };
  }

  // Recalibre sur les 30 prochaines mesures, téléphone loin de tout appareil.
  calibrate() {
    this.calibrating = [];
  }

  resetPeak() {
    this.peak = 0;
  }
}

// 0..1 pour la jauge, échelle logarithmique jusqu'à 300 µT d'écart.
export function gaugeRatio(delta, max = 300) {
  const d = Math.min(max, Math.abs(delta));
  return Math.log10(1 + d) / Math.log10(1 + max);
}
