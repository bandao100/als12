// Sons d'alerte, crépitement façon compteur Geiger, synthèse vocale et vibrations.
import { isNative, nativeCall } from './native.js';
import { settings } from './store.js';

let ctx = null;
let master = null;

export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// À appeler depuis un geste de l'utilisateur pour débloquer le son sur mobile.
export function unlockAudio() {
  audioContext();
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
}

export function beep({ freq = 880, duration = 0.12, type = 'sine', gain = 0.18, delay = 0 } = {}) {
  if (!settings.get('sound')) return;
  const ac = audioContext();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function chime(kind) {
  switch (kind) {
    case 'far':
      beep({ freq: 740, duration: 0.16 });
      beep({ freq: 988, duration: 0.2, delay: 0.18 });
      break;
    case 'near':
      for (let i = 0; i < 3; i++) beep({ freq: 1046, duration: 0.11, type: 'triangle', delay: i * 0.15 });
      break;
    case 'imminent':
      for (let i = 0; i < 5; i++) beep({ freq: 1318, duration: 0.08, type: 'square', gain: 0.12, delay: i * 0.1 });
      break;
    case 'over':
      beep({ freq: 1568, duration: 0.09, type: 'square', gain: 0.12 });
      beep({ freq: 1568, duration: 0.09, type: 'square', gain: 0.12, delay: 0.14 });
      break;
    case 'exit':
      beep({ freq: 988, duration: 0.12 });
      beep({ freq: 660, duration: 0.2, delay: 0.13 });
      break;
    case 'found':
      beep({ freq: 1200, duration: 0.07, type: 'triangle' });
      break;
    default:
      beep();
  }
}

let noiseBuffer = null;
function click(gain) {
  const ac = audioContext();
  if (!ac) return;
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, Math.round(ac.sampleRate * 0.004), ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  }
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = gain;
  src.buffer = noiseBuffer;
  src.connect(g).connect(master);
  src.start();
}

// Crépitement aléatoire (processus de Poisson) dont la cadence suit l'intensité.
export class Clicker {
  constructor() {
    this.rate = 0;
    this.timer = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  loop() {
    if (!this.running) return;
    if (this.rate > 0.2 && settings.get('sound')) click(0.5);
    const rate = Math.max(0.2, this.rate);
    const wait = Math.min(2000, Math.max(12, (-Math.log(1 - Math.random()) / rate) * 1000));
    this.timer = setTimeout(() => this.loop(), wait);
  }

  setRate(perSecond) {
    this.rate = Math.max(0, Math.min(60, perSecond));
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}

let frenchVoice = null;
function pickVoice() {
  if (frenchVoice || !('speechSynthesis' in window)) return frenchVoice;
  const voices = window.speechSynthesis.getVoices();
  frenchVoice = voices.find((v) => v.lang === 'fr-FR') || voices.find((v) => v.lang?.startsWith('fr')) || null;
  return frenchVoice;
}

export function speak(text) {
  if (!settings.get('voice')) return;
  // La WebView Android n'a pas de synthèse vocale : on passe par la voix du téléphone.
  if (isNative) {
    nativeCall('speak', text).catch(() => {});
    return;
  }
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function vibrate(pattern) {
  if (!settings.get('vibrate')) return;
  if (isNative) {
    nativeCall('vibrate', Array.isArray(pattern) ? pattern : [pattern]).catch(() => {});
    return;
  }
  if (!('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibration refusée */
  }
}
