// Analyse spectrale du micro : repère les tonalités ultrasonores (≥ 17 kHz).

export function binFrequency(i, sampleRate, fftSize) {
  return (i * sampleRate) / fftSize;
}

export function frequencyBin(freq, sampleRate, fftSize) {
  return Math.round((freq * fftSize) / sampleRate);
}

function median(values) {
  const a = Float32Array.from(values).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// db : Float32Array issu de AnalyserNode.getFloatFrequencyData (dBFS par bande).
export function findTonalPeaks(db, sampleRate, fftSize, { minFreq = 17000, maxFreq = 24000, minProminence = 14, maxPeaks = 5 } = {}) {
  const lo = Math.max(1, frequencyBin(minFreq, sampleRate, fftSize));
  const hi = Math.min(db.length - 2, frequencyBin(maxFreq, sampleRate, fftSize));
  if (hi <= lo) return { floor: -Infinity, peaks: [] };
  const band = [];
  for (let i = lo; i <= hi; i++) if (Number.isFinite(db[i])) band.push(db[i]);
  if (!band.length) return { floor: -Infinity, peaks: [] };
  const floor = median(band);
  const candidates = [];
  for (let i = lo; i <= hi; i++) {
    const v = db[i];
    if (!Number.isFinite(v) || v - floor < minProminence) continue;
    let isMax = true;
    for (let k = 1; k <= 3 && isMax; k++) {
      if (db[i - k] > v || db[i + k] > v) isMax = false;
    }
    if (isMax) candidates.push({ bin: i, freq: binFrequency(i, sampleRate, fftSize), db: v, prominence: v - floor });
  }
  candidates.sort((a, b) => b.prominence - a.prominence);
  const peaks = [];
  for (const c of candidates) {
    if (peaks.some((p) => Math.abs(p.freq - c.freq) < 150)) continue;
    peaks.push(c);
    if (peaks.length >= maxPeaks) break;
  }
  return { floor, peaks };
}

// Énergie moyenne d'une bande, en dB.
export function bandLevel(db, sampleRate, fftSize, minFreq, maxFreq) {
  const lo = Math.max(0, frequencyBin(minFreq, sampleRate, fftSize));
  const hi = Math.min(db.length - 1, frequencyBin(maxFreq, sampleRate, fftSize));
  let sum = 0, n = 0;
  for (let i = lo; i <= hi; i++) {
    if (!Number.isFinite(db[i])) continue;
    sum += 10 ** (db[i] / 10);
    n++;
  }
  return n ? 10 * Math.log10(sum / n) : -Infinity;
}

export function formatFrequency(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(1).replace('.', ',')} kHz`;
  return `${Math.round(hz)} Hz`;
}

// Suit les tonalités dans le temps pour ne garder que celles qui durent.
export class ToneTracker {
  constructor({ tolerance = 120, minFrames = 6, maxGap = 8 } = {}) {
    this.tolerance = tolerance;
    this.minFrames = minFrames;
    this.maxGap = maxGap;
    this.tones = [];
  }

  update(peaks, now = Date.now()) {
    for (const t of this.tones) t.gap++;
    for (const p of peaks) {
      const t = this.tones.find((x) => Math.abs(x.freq - p.freq) < this.tolerance);
      if (t) {
        t.freq += (p.freq - t.freq) * 0.3;
        t.prominence = Math.max(p.prominence, t.prominence * 0.9);
        t.frames++;
        t.gap = 0;
        t.last = now;
      } else {
        this.tones.push({ freq: p.freq, prominence: p.prominence, frames: 1, gap: 0, first: now, last: now });
      }
    }
    this.tones = this.tones.filter((t) => t.gap <= this.maxGap);
    return this.tones.filter((t) => t.frames >= this.minFrames).sort((a, b) => b.prominence - a.prominence);
  }
}
