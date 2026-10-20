import { Clicker, unlockAudio, vibrate } from '../core/audio.js';
import { EmfMeter, LEVELS, gaugeRatio } from '../core/emf.js';
import { icons } from '../core/icons.js';
import { settings } from '../core/store.js';
import { $, animationLoop, el, hiDpiCanvas, nf, themeColors, toast } from '../core/ui.js';
import { createDemoMagnetometer } from '../sim/demo.js';

const levelTone = { calm: 'ok', low: 'ok', moderate: 'warn', high: 'danger', intense: 'danger' };

export function emfScreen() {
  const root = el(`
    <section class="screen" aria-labelledby="e-title">
      <div class="screen-head">
        <span class="eyebrow">Champs magnétiques</span>
        <h1 id="e-title">Magnétomètre</h1>
        <p>Mesure en microteslas l'écart au champ terrestre. Approchez le téléphone des objets : un micro-émetteur, une caméra alimentée ou un transformateur fait grimper l'aiguille.</p>
      </div>

      <div class="gauge-wrap">
        <canvas id="e-gauge" role="img" aria-label="Jauge du champ magnétique"></canvas>
        <div class="gauge-center">
          <span class="gauge-value mono" id="e-delta">—</span>
          <span class="gauge-unit">µT d'écart</span>
          <span class="gauge-level" id="e-level">À l'arrêt</span>
        </div>
      </div>

      <p class="small muted" id="e-hint" style="text-align:center">Posez le téléphone loin de tout appareil, puis démarrez la mesure.</p>

      <div class="btn-row">
        <button class="btn btn-primary" id="e-toggle" type="button">${icons.play}<span>Démarrer la mesure</span></button>
        <button class="btn" id="e-cal" type="button" disabled>${icons.calibrate}<span>Recalibrer</span></button>
        <button class="icon-btn" id="e-sound" type="button" aria-pressed="true" aria-label="Crépitement sonore">${icons.sound}</button>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat-label">Champ total</span><span class="stat-value" id="e-total">—</span></div>
        <div class="stat"><span class="stat-label">Référence</span><span class="stat-value" id="e-base">—</span></div>
        <div class="stat"><span class="stat-label">Pic</span><span class="stat-value" id="e-peak">—</span></div>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Historique · 15 s</h2><span class="small muted mono" id="e-rate"></span></div>
        <canvas class="spark" id="e-spark" aria-hidden="true"></canvas>
      </div>

      <div class="panel axes" id="e-axes">
        ${['x', 'y', 'z'].map((a) => `<div class="axis"><span class="muted">${a.toUpperCase()}</span><div class="axis-track"><span id="e-ax-${a}"></span></div><span class="val" id="e-v-${a}">—</span></div>`).join('')}
      </div>

      <div class="note" id="e-support" hidden>${icons.info}<p></p></div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Écart</th><th>Niveau</th><th>Interprétation</th></tr></thead>
          <tbody>
            ${LEVELS.map((l, i) => `<tr><td class="mono">${i === LEVELS.length - 1 ? `≥ ${LEVELS[i - 1].max}` : `< ${l.max}`} µT</td><td><span class="chip" data-tone="${levelTone[l.key]}">${l.label}</span></td><td>${l.hint}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`);

  const meter = new EmfMeter();
  const clicker = new Clicker();
  const st = { running: false, sensor: null, demoTimer: 0, last: null, readings: 0, rateAt: performance.now(), soundOn: true };
  let gauge = null;
  let spark = null;
  let loop = null;

  function showSupport(html) {
    const n = $('#e-support', root);
    n.hidden = !html;
    if (html) n.querySelector('p').innerHTML = html;
  }

  function onReading(x, y, z) {
    const r = meter.update(x, y, z);
    if (!r) return;
    st.last = r;
    st.readings++;
    if (st.soundOn) clicker.setRate(Math.abs(r.delta) < 3 ? 0 : Math.abs(r.delta) / 4);
    if (r.level.key === 'high' && st.lastLevel !== 'high' && st.lastLevel !== 'intense') vibrate(120);
    st.lastLevel = r.level.key;
  }

  async function start() {
    unlockAudio();
    meter.history = [];
    meter.baseline = null;
    meter.smoothed = null;
    meter.peak = 0;
    meter.calibrate();
    if (settings.get('demo')) {
      const next = createDemoMagnetometer();
      st.demoTimer = setInterval(() => {
        const v = next();
        onReading(v.x, v.y, v.z);
      }, 1000 / 30);
      running(true);
      return;
    }
    if (!('Magnetometer' in window)) {
      showSupport(unsupportedText());
      return;
    }
    try {
      const perm = await navigator.permissions?.query({ name: 'magnetometer' }).catch(() => null);
      if (perm?.state === 'denied') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      st.sensor = new window.Magnetometer({ frequency: 30 });
      st.sensor.addEventListener('reading', () => onReading(st.sensor.x, st.sensor.y, st.sensor.z));
      st.sensor.addEventListener('error', (e) => {
        showSupport(e.error?.name === 'NotAllowedError' ? "L'accès au magnétomètre a été refusé pour ce site." : "Le magnétomètre n'a pas pu démarrer sur cet appareil.");
        stop();
      });
      st.sensor.start();
      running(true);
    } catch (e) {
      showSupport(e.name === 'NotAllowedError' ? "L'accès au magnétomètre a été refusé pour ce site." : unsupportedText());
    }
  }

  function unsupportedText() {
    return "<strong>Magnétomètre non exposé par ce navigateur.</strong> Sur Android avec Chrome, ouvrez <code>chrome://flags/#enable-generic-sensor-extra-classes</code>, activez l'option puis relancez Chrome. Sur iPhone, Safari ne donne pas accès à ce capteur. Vous pouvez essayer l'interface avec le mode démo (Réglages).";
  }

  function stop() {
    clearInterval(st.demoTimer);
    st.sensor?.stop();
    st.sensor = null;
    clicker.stop();
    running(false);
  }

  function running(on) {
    st.running = on;
    const t = $('#e-toggle', root);
    t.className = `btn ${on ? 'btn-danger' : 'btn-primary'}`;
    t.innerHTML = on ? `${icons.stop}<span>Arrêter</span>` : `${icons.play}<span>Démarrer la mesure</span>`;
    $('#e-cal', root).disabled = !on;
    if (on) {
      showSupport('');
      if (st.soundOn) clicker.start();
      loop.start();
    } else {
      loop.stop();
      drawGauge(performance.now());
    }
  }

  function drawGauge(t) {
    if (!gauge?.width) return;
    const { ctx, width: w, height: h } = gauge;
    const c = themeColors();
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 14;
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    // Piste et zones colorées.
    const zones = [
      [0, gaugeRatio(15), c.ok],
      [gaugeRatio(15), gaugeRatio(40), c.warn],
      [gaugeRatio(40), 1, c.danger],
    ];
    ctx.lineWidth = Math.max(10, R * 0.08);
    ctx.strokeStyle = c.raise;
    ctx.beginPath();
    ctx.arc(cx, cy, R, start, start + sweep);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (const [a, b, col] of zones) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R + ctx.lineWidth + Math.max(10, R * 0.08) / 2, start + a * sweep, start + b * sweep);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Graduations aux valeurs remarquables.
    ctx.font = `600 ${Math.max(10, R * 0.07)}px ${c.mono}`;
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const v of [0, 5, 15, 40, 100, 300]) {
      const a = start + gaugeRatio(v) * sweep;
      ctx.fillText(String(v), cx + Math.cos(a) * (R - R * 0.2), cy + Math.sin(a) * (R - R * 0.2));
    }
    const r = st.last;
    const ratio = r ? gaugeRatio(r.delta) : 0;
    const col = !r ? c.line : ratio < gaugeRatio(15) ? c.ok : ratio < gaugeRatio(40) ? c.warn : c.danger;
    ctx.lineWidth = Math.max(10, R * 0.08);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, R, start, start + Math.max(0.001, ratio) * sweep);
    ctx.stroke();
    // Repère du pic.
    if (r && st.running) {
      const pa = start + gaugeRatio(meter.peak) * sweep;
      ctx.strokeStyle = c.fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(pa) * (R - 10), cy + Math.sin(pa) * (R - 10));
      ctx.lineTo(cx + Math.cos(pa) * (R + 10), cy + Math.sin(pa) * (R + 10));
      ctx.stroke();
      // Lueur qui respire au rythme de l'intensité.
      ctx.globalAlpha = 0.12 + 0.1 * Math.sin(t / (300 - ratio * 200));
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawSpark() {
    if (!spark?.width) return;
    const { ctx, width: w, height: h } = spark;
    const c = themeColors();
    ctx.clearRect(0, 0, w, h);
    const now = Date.now();
    const pts = meter.history.filter((p) => now - p.t < 15000);
    const max = Math.max(20, ...pts.map((p) => Math.abs(p.delta))) * 1.15;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    ctx.font = `500 10px ${c.mono}`;
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(max)} µT`, 4, 3);
    if (pts.length < 2) return;
    const x = (p) => w - ((now - p.t) / 15000) * w;
    const y = (p) => h - (Math.abs(p.delta) / max) * (h - 6) - 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p), y(p)) : ctx.moveTo(x(p), y(p))));
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(x(pts[pts.length - 1]), h);
    ctx.lineTo(x(pts[0]), h);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    const last = pts[pts.length - 1];
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(x(last), y(last), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderText() {
    const r = st.last;
    const f1 = nf(1);
    if (!r) return;
    $('#e-delta', root).textContent = `${r.delta >= 0 ? '+' : '−'}${f1.format(Math.abs(r.delta))}`;
    const lvl = $('#e-level', root);
    lvl.textContent = meter.calibrating ? 'Calibrage…' : r.level.label;
    lvl.style.color = `var(--${{ ok: 'ok', warn: 'warn', danger: 'danger' }[levelTone[r.level.key]]})`;
    $('#e-hint', root).textContent = meter.calibrating ? 'Gardez le téléphone immobile, loin des appareils.' : r.level.hint;
    $('#e-total', root).textContent = `${f1.format(r.smoothed)} µT`;
    $('#e-base', root).textContent = meter.baseline != null ? `${f1.format(meter.baseline)} µT` : '—';
    $('#e-peak', root).textContent = `${f1.format(Math.abs(meter.peak))} µT`;
    const { x, y, z } = meter.last;
    for (const [k, v] of Object.entries({ x, y, z })) {
      const bar = $(`#e-ax-${k}`, root);
      const pct = Math.min(50, (Math.abs(v) / 200) * 50);
      bar.style.width = `${pct}%`;
      bar.style.left = v >= 0 ? '50%' : `${50 - pct}%`;
      $(`#e-v-${k}`, root).textContent = `${f1.format(v)}`;
    }
    const now = performance.now();
    if (now - st.rateAt > 1000) {
      $('#e-rate', root).textContent = `${Math.round((st.readings * 1000) / (now - st.rateAt))} mesures/s`;
      st.readings = 0;
      st.rateAt = now;
    }
  }

  $('#e-toggle', root).addEventListener('click', () => (st.running ? stop() : start()));
  $('#e-cal', root).addEventListener('click', () => {
    meter.calibrate();
    toast('Calibrage : gardez le téléphone immobile une seconde.');
  });
  $('#e-sound', root).addEventListener('click', (e) => {
    st.soundOn = !st.soundOn;
    e.currentTarget.setAttribute('aria-pressed', String(st.soundOn));
    e.currentTarget.innerHTML = st.soundOn ? icons.sound : icons.mute;
    if (st.soundOn && st.running) clicker.start();
    else clicker.stop();
  });

  return {
    root,
    mount() {
      gauge = hiDpiCanvas($('#e-gauge', root), () => drawGauge(performance.now()));
      spark = hiDpiCanvas($('#e-spark', root), drawSpark);
      loop = animationLoop((t) => {
        drawGauge(t);
        drawSpark();
        renderText();
      });
      drawGauge(performance.now());
      drawSpark();
      if (!('Magnetometer' in window) && !settings.get('demo')) showSupport(unsupportedText());
    },
    unmount() {
      if (st.running) stop();
      gauge?.dispose();
      spark?.dispose();
    },
  };
}
