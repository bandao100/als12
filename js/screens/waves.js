import { Clicker, audioContext, chime, unlockAudio, vibrate } from '../core/audio.js';
import { KINDS, RssiFilter, estimateDistance, identifyDevice, proximityLabel, rssiToLevel } from '../core/ble.js';
import { icons, kindIcons } from '../core/icons.js';
import { fromNativeAdvert, isNative, nativeCall, nativePoll } from '../core/native.js';
import { ToneTracker, bandLevel, findTonalPeaks, formatFrequency } from '../core/spectrum.js';
import { settings } from '../core/store.js';
import { $, animationLoop, el, escapeHtml, hiDpiCanvas, nf, themeColors, toast } from '../core/ui.js';
import { band, channel, rankNetworks, security, signalLabel } from '../core/wifi.js';
import { createDemoBluetooth, createDemoSpectrum, createDemoWifi } from '../sim/demo.js';

const RISK_ORDER = { high: 0, medium: 1, low: 2 };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toneSource(freq) {
  if (freq < 17000) return 'Sifflement électronique (transformateur, alimentation, écran)';
  if (freq < 19000) return 'Répulsif, détecteur de présence ou alimentation à découpage';
  return 'Balise ultrasonore (pistage publicitaire, appairage) ou capteur';
}

export function wavesScreen() {
  const root = el(`
    <section class="screen" aria-labelledby="w-title">
      <div class="screen-head">
        <span class="eyebrow">Ondes</span>
        <h1 id="w-title">Radio et ultrasons</h1>
        <p>Recense les appareils Bluetooth et les réseaux Wi-Fi autour de vous, repère les traceurs (AirTag, SmartTag, Tile) et les points d'accès de caméras, et capte les ultrasons qu'émettent certains appareils.</p>
      </div>

      <div class="seg" id="w-tabs" role="group" aria-label="Type d'ondes">
        <button type="button" data-tab="ble" aria-pressed="true">Bluetooth</button>
        <button type="button" data-tab="wifi" aria-pressed="false">Wi-Fi</button>
        <button type="button" data-tab="us" aria-pressed="false">Ultrasons</button>
      </div>

      <div id="w-ble" class="stack">
        <div class="btn-row">
          <button class="btn btn-primary" id="b-toggle" type="button">${icons.bluetooth}<span>Scanner les appareils</span></button>
        </div>
        <div class="sensor-strip" id="b-summary"></div>
        <div class="panel hunt" id="b-hunt" hidden>
          <canvas class="hunt-meter" id="b-meter" aria-hidden="true"></canvas>
          <div>
            <span class="eyebrow">Pistage</span>
            <h3 id="b-hunt-name">—</h3>
            <p class="mono" id="b-hunt-rssi">—</p>
            <p class="small muted" id="b-hunt-trend">Déplacez-vous lentement : le crépitement accélère quand vous vous rapprochez.</p>
          </div>
        </div>
        <div class="panel">
          <div class="section-title"><h2>Appareils détectés</h2><span class="small muted" id="b-count"></span></div>
          <ul class="list" id="b-list"><li class="empty">Lancez le scan pour lister les appareils Bluetooth à portée (environ 10 à 30 m).</li></ul>
        </div>
        <div class="note" id="b-support">${icons.info}<p></p></div>
      </div>

      <div id="w-wifi" class="stack" hidden>
        <div class="btn-row">
          <button class="btn btn-primary" id="f-scan" type="button">${icons.wifi}<span>Analyser les réseaux Wi-Fi</span></button>
        </div>
        <div class="sensor-strip" id="f-summary"></div>
        <div class="panel">
          <div class="section-title"><h2>Réseaux à portée</h2><span class="small muted" id="f-count"></span></div>
          <ul class="list" id="f-list"><li class="empty">Lancez l'analyse : les points d'accès de caméras et d'objets connectés apparaîtront en tête de liste.</li></ul>
        </div>
        <div class="note" id="f-note">${icons.info}<p></p></div>
      </div>

      <div id="w-us" class="stack" hidden>
        <div class="btn-row">
          <button class="btn btn-primary" id="u-toggle" type="button">${icons.mic}<span>Écouter les ultrasons</span></button>
        </div>
        <canvas class="waterfall" id="u-fall" role="img" aria-label="Spectrogramme"></canvas>
        <div class="stats">
          <div class="stat"><span class="stat-label">17–22 kHz</span><span class="stat-value" id="u-band">—</span></div>
          <div class="stat"><span class="stat-label">Bruit</span><span class="stat-value" id="u-floor">—</span></div>
          <div class="stat"><span class="stat-label">Micro</span><span class="stat-value" id="u-sr">—</span></div>
        </div>
        <div class="panel">
          <div class="section-title"><h2>Tonalités persistantes</h2><span class="small muted" id="u-count"></span></div>
          <ul class="list" id="u-list"><li class="empty">Aucune tonalité pour l'instant. Une émission stable au-dessus de 15 kHz apparaîtra ici.</li></ul>
        </div>
        <div class="note">${icons.info}<p>Le son n'est ni enregistré ni envoyé : seul son spectre est analysé sur l'appareil. <strong>Limite :</strong> beaucoup de micros de téléphone atténuent fortement au-delà de 20 kHz ; une absence de détection ne prouve pas l'absence d'émission.</p></div>
      </div>
    </section>`);

  // ───── Bluetooth ─────
  const ble = { running: false, scan: null, demo: null, timer: 0, devices: new Map(), selected: null, lastRender: 0, clicker: new Clicker(), meter: null, history: [] };
  const supportNote = $('#b-support', root);

  function setSupport(html) {
    supportNote.hidden = !html;
    if (html) supportNote.querySelector('p').innerHTML = html;
  }

  function supportText() {
    if (settings.get('demo') || isNative) return '';
    if (navigator.bluetooth?.requestLEScan) return '';
    if (navigator.bluetooth)
      return "<strong>Scan continu non activé.</strong> Chrome n'ouvre ici qu'une liste système des appareils proches. Pour un scan complet avec puissance du signal, ouvrez <code>chrome://flags/#enable-experimental-web-platform-features</code>, activez l'option et relancez Chrome.";
    return "<strong>Bluetooth inaccessible dans ce navigateur.</strong> Utilisez Chrome sur Android (Safari sur iPhone ne propose pas le Web Bluetooth). Pour les caméras Wi-Fi, ouvrez la liste des réseaux de votre téléphone : des noms comme « IPC », « CAM », « HD-», « YI », « Tapo » ou « EZVIZ » doivent attirer l'attention.";
  }

  function onAdvert(a) {
    let d = ble.devices.get(a.id);
    if (!d) {
      d = { id: a.id, filter: new RssiFilter(), first: Date.now(), count: 0, info: null, name: null };
      ble.devices.set(a.id, d);
    }
    d.name = a.name || d.name;
    d.rssi = d.filter.update(a.rssi);
    d.txPower = a.txPower;
    d.last = Date.now();
    d.count++;
    const before = d.info?.kind;
    d.info = identifyDevice({ name: d.name, manufacturerData: a.manufacturerData, serviceData: a.serviceData, uuids: a.uuids });
    if (d.info.risk === 'high' && before !== d.info.kind) {
      chime('found');
      vibrate([80, 60, 80]);
    }
    if (ble.selected === d.id) ble.history.push({ t: Date.now(), rssi: d.rssi });
    const now = performance.now();
    if (now - ble.lastRender > 250) {
      ble.lastRender = now;
      renderDevices();
    }
  }

  const advHandler = (e) =>
    onAdvert({
      id: e.device.id,
      name: e.name || e.device.name,
      rssi: e.rssi,
      txPower: e.txPower,
      manufacturerData: e.manufacturerData,
      serviceData: e.serviceData,
      uuids: e.uuids,
    });

  async function bleStart() {
    unlockAudio();
    if (settings.get('demo')) {
      const next = createDemoBluetooth();
      ble.timer = setInterval(() => next().forEach(onAdvert), 350);
      bleRunning(true);
      return;
    }
    if (isNative) {
      await bleStartNative();
      return;
    }
    if (!navigator.bluetooth) {
      setSupport(supportText());
      return;
    }
    if (navigator.bluetooth.requestLEScan) {
      try {
        ble.scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
        navigator.bluetooth.addEventListener('advertisementreceived', advHandler);
        bleRunning(true);
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Scan Bluetooth refusé.' : 'Impossible de lancer le scan Bluetooth.', { tone: 'danger' });
      }
      return;
    }
    // Repli : sélecteur système, un appareil à la fois.
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      onAdvert({ id: device.id, name: device.name, rssi: NaN });
      if (device.watchAdvertisements) {
        device.addEventListener('advertisementreceived', advHandler);
        await device.watchAdvertisements().catch(() => {});
      }
      renderDevices();
    } catch (e) {
      if (e.name !== 'NotFoundError') toast("Le sélecteur Bluetooth n'a pas pu s'ouvrir.", { tone: 'danger' });
    }
  }

  // Application Android : scan BLE natif en basse latence, relevé toutes les 300 ms.
  async function bleStartNative() {
    try {
      const perm = await nativeCall('permissions', 'bluetooth');
      if (!perm?.granted) {
        toast('Autorisez « Appareils à proximité » pour que Sentinelle puisse scanner le Bluetooth.', { tone: 'danger', timeout: 5000 });
        return;
      }
      const res = await nativeCall('ble.start');
      if (!res?.ok) {
        if (res?.reason === 'off') {
          toast('Activez le Bluetooth puis relancez le scan.', { tone: 'danger' });
          nativeCall('settings', 'bluetooth').catch(() => {});
        } else toast("Ce téléphone n'a pas de Bluetooth basse consommation.", { tone: 'danger' });
        return;
      }
    } catch {
      toast('Impossible de lancer le scan Bluetooth.', { tone: 'danger' });
      return;
    }
    ble.native = true;
    ble.timer = setInterval(() => {
      const r = nativePoll('ble');
      if (!r) return;
      for (const d of r.devices || []) onAdvert(fromNativeAdvert(d));
      if (r.error && !ble.errorShown) {
        ble.errorShown = true;
        toast('Android a suspendu le scan (trop de relances rapprochées). Patientez 30 s puis relancez.', { timeout: 5000 });
      }
      renderDevices();
    }, 300);
    bleRunning(true);
  }

  function bleStop() {
    clearInterval(ble.timer);
    if (ble.native) {
      ble.native = false;
      ble.errorShown = false;
      nativeCall('ble.stop').catch(() => {});
    }
    if (ble.scan) {
      ble.scan.stop();
      navigator.bluetooth.removeEventListener('advertisementreceived', advHandler);
      ble.scan = null;
    }
    ble.clicker.stop();
    bleRunning(false);
  }

  function bleRunning(on) {
    ble.running = on;
    const b = $('#b-toggle', root);
    b.className = `btn ${on ? 'btn-danger' : 'btn-primary'}`;
    b.innerHTML = on ? `${icons.stop}<span>Arrêter le scan</span>` : `${icons.bluetooth}<span>Scanner les appareils</span>`;
    if (on) {
      setSupport(supportText());
      huntLoop.start();
      if (ble.selected) ble.clicker.start();
    } else huntLoop.stop();
  }

  function renderDevices() {
    const now = Date.now();
    const list = [...ble.devices.values()].filter((d) => now - d.last < 30000);
    list.sort((a, b) => RISK_ORDER[a.info.risk] - RISK_ORDER[b.info.risk] || (b.rssi ?? -200) - (a.rssi ?? -200));
    const trackers = list.filter((d) => d.info.kind === 'tracker').length;
    const cams = list.filter((d) => d.info.kind === 'camera').length;
    $('#b-count', root).textContent = list.length ? `${list.length} à portée` : '';
    $('#b-summary', root).innerHTML = list.length
      ? [
          `<span class="chip" data-tone="accent">${list.length} appareil${list.length > 1 ? 's' : ''}</span>`,
          `<span class="chip" data-tone="${trackers ? 'danger' : 'ok'}">${trackers} traceur${trackers > 1 ? 's' : ''}</span>`,
          cams ? `<span class="chip" data-tone="danger">${cams} caméra${cams > 1 ? 's' : ''} possible${cams > 1 ? 's' : ''}</span>` : '',
        ].join('')
      : '';
    const ul = $('#b-list', root);
    if (!list.length) {
      ul.innerHTML = `<li class="empty">${ble.running ? 'Recherche en cours…' : 'Lancez le scan pour lister les appareils Bluetooth à portée (environ 10 à 30 m).'}</li>`;
      return;
    }
    ul.innerHTML = list
      .map((d) => {
        const dist = estimateDistance(d.rssi, d.txPower);
        const level = rssiToLevel(d.rssi);
        const bars = [0.15, 0.4, 0.65, 0.85].map((t) => `<i class="${level >= t ? 'on' : ''}"></i>`).join('');
        const title = d.name && !d.info.label.includes(d.name) ? `${d.info.label} · ${d.name}` : d.info.label;
        const sub = [d.info.vendor, Number.isFinite(d.rssi) ? `${Math.round(d.rssi)} dBm` : null, dist ? `≈ ${nf(dist < 10 ? 1 : 0).format(dist)} m · ${proximityLabel(dist)}` : null]
          .filter(Boolean)
          .join(' · ');
        return `<li class="device${ble.selected === d.id ? ' selected' : ''}" data-id="${escapeHtml(d.id)}" data-risk="${d.info.risk}" tabindex="0" role="button" aria-label="Pister ${escapeHtml(title)}">
          <span class="kind-badge">${kindIcons[d.info.kind] || icons.bluetooth}</span>
          <div class="grow"><div class="title">${escapeHtml(title)}</div>${d.info.risk === 'high' ? `<div class="tags"><span class="chip" data-tone="danger">${KINDS[d.info.kind].label}</span></div>` : ''}<div class="sub">${escapeHtml(sub)}</div></div>
          <span class="bars" aria-hidden="true">${bars}</span>
        </li>`;
      })
      .join('');
  }

  function select(id) {
    ble.selected = ble.selected === id ? null : id;
    ble.history = [];
    $('#b-hunt', root).hidden = !ble.selected;
    if (ble.selected && ble.running) ble.clicker.start();
    else ble.clicker.stop();
    renderDevices();
  }

  const onListClick = (e) => {
    const li = e.target.closest('li.device');
    if (li) select(li.dataset.id);
  };
  $('#b-list', root).addEventListener('click', onListClick);
  $('#b-list', root).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onListClick(e);
    }
  });

  const huntLoop = animationLoop((t) => {
    const d = ble.selected && ble.devices.get(ble.selected);
    if (!d || !ble.meter?.width) return;
    const { ctx, width: w, height: h } = ble.meter;
    const c = themeColors();
    const level = rssiToLevel(d.rssi);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 6;
    ctx.clearRect(0, 0, w, h);
    for (let i = 3; i >= 1; i--) {
      const pulse = ((t / (900 - level * 600) + i / 3) % 1);
      ctx.globalAlpha = (1 - pulse) * 0.5;
      ctx.strokeStyle = d.info.risk === 'high' ? c.danger : c.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (0.3 + pulse * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.raise;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = level > 0.7 ? c.danger : level > 0.45 ? c.warn : c.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, -Math.PI / 2, -Math.PI / 2 + level * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c.fg;
    ctx.font = `700 ${R * 0.42}px ${c.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(level * 100)}`, cx, cy);

    ble.clicker.setRate(level ** 2 * 30);
    $('#b-hunt-name', root).textContent = d.name ? `${d.info.label} · ${d.name}` : d.info.label;
    const dist = estimateDistance(d.rssi, d.txPower);
    $('#b-hunt-rssi', root).textContent = Number.isFinite(d.rssi) ? `${Math.round(d.rssi)} dBm · ≈ ${nf(1).format(dist)} m` : 'Signal non mesuré';
    const now = Date.now();
    ble.history = ble.history.filter((p) => now - p.t < 6000);
    const recent = ble.history.filter((p) => now - p.t < 2000);
    const older = ble.history.filter((p) => now - p.t >= 2000);
    if (recent.length > 2 && older.length > 2) {
      const avg = (a) => a.reduce((s, p) => s + p.rssi, 0) / a.length;
      const diff = avg(recent) - avg(older);
      $('#b-hunt-trend', root).textContent = diff > 2 ? 'Plus chaud : vous vous rapprochez.' : diff < -2 ? 'Plus froid : vous vous éloignez.' : 'Signal stable : changez de direction.';
    }
  });

  $('#b-toggle', root).addEventListener('click', () => (ble.running ? bleStop() : bleStart()));

  // ───── Ultrasons ─────
  const us = { running: false, stream: null, analyser: null, db: null, demo: null, tracker: new ToneTracker(), off: null, octx: null, view: null, lastList: 0, sampleRate: 48000, fftSize: 4096 };
  const COLS = 512;
  const ROWS = 180;

  function colormap() {
    const c = themeColors();
    const stops = [c.scopeBg, c.scopeRing, c.accent, c.warn, c.fg].map(hexToRgb);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(t));
      const f = t - k;
      for (let j = 0; j < 3; j++) lut[i * 3 + j] = stops[k][j] + (stops[k + 1][j] - stops[k][j]) * f;
    }
    return lut;
  }
  let lut = null;

  async function usStart() {
    unlockAudio();
    lut = colormap();
    us.tracker = new ToneTracker();
    if (settings.get('demo')) {
      us.demo = createDemoSpectrum();
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast('Micro inaccessible dans ce navigateur.', { tone: 'danger' });
        return;
      }
      try {
        us.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Accès au micro refusé.' : "Impossible d'ouvrir le micro.", { tone: 'danger' });
        return;
      }
      const ac = audioContext();
      const src = ac.createMediaStreamSource(us.stream);
      us.analyser = ac.createAnalyser();
      us.analyser.fftSize = us.fftSize;
      us.analyser.smoothingTimeConstant = 0.15;
      us.analyser.minDecibels = -120;
      us.analyser.maxDecibels = -20;
      src.connect(us.analyser);
      us.sampleRate = ac.sampleRate;
      us.db = new Float32Array(us.analyser.frequencyBinCount);
    }
    us.off = document.createElement('canvas');
    us.off.width = COLS;
    us.off.height = ROWS;
    us.octx = us.off.getContext('2d');
    us.octx.fillStyle = themeColors().scopeBg;
    us.octx.fillRect(0, 0, COLS, ROWS);
    us.running = true;
    const b = $('#u-toggle', root);
    b.className = 'btn btn-danger';
    b.innerHTML = `${icons.stop}<span>Arrêter l'écoute</span>`;
    usLoop.start();
  }

  function usStop() {
    us.running = false;
    usLoop.stop();
    us.stream?.getTracks().forEach((t) => t.stop());
    us.stream = null;
    us.analyser = null;
    us.demo = null;
    const b = $('#u-toggle', root);
    b.className = 'btn btn-primary';
    b.innerHTML = `${icons.mic}<span>Écouter les ultrasons</span>`;
  }

  let frame = 0;
  const usLoop = animationLoop(() => {
    if (!us.running) return;
    let db, sampleRate, fftSize;
    if (us.demo) ({ db, sampleRate, fftSize } = us.demo());
    else {
      us.analyser.getFloatFrequencyData(us.db);
      db = us.db;
      sampleRate = us.sampleRate;
      fftSize = us.fftSize;
    }
    const nyquist = sampleRate / 2;
    // Nouvelle ligne du spectrogramme : on fait défiler vers le haut.
    us.octx.drawImage(us.off, 0, -1);
    const row = us.octx.createImageData(COLS, 1);
    for (let x = 0; x < COLS; x++) {
      const bin = Math.min(db.length - 1, Math.floor((x / COLS) * db.length));
      const v = Math.max(0, Math.min(255, Math.round(((db[bin] + 115) / 75) * 255)));
      row.data[x * 4] = lut[v * 3];
      row.data[x * 4 + 1] = lut[v * 3 + 1];
      row.data[x * 4 + 2] = lut[v * 3 + 2];
      row.data[x * 4 + 3] = 255;
    }
    us.octx.putImageData(row, 0, ROWS - 1);

    const { floor, peaks } = findTonalPeaks(db, sampleRate, fftSize, { minFreq: 15000, maxFreq: Math.min(23500, nyquist - 200) });
    const tones = us.tracker.update(peaks);

    const v = us.view;
    if (v?.width) {
      const { ctx, width: w, height: h } = v;
      const c = themeColors();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(us.off, 0, 0, w, h);
      const fx = (f) => (f / nyquist) * w;
      ctx.fillStyle = c.report;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(fx(17000), 0, w - fx(17000), h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.report;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(fx(17000), 0);
      ctx.lineTo(fx(17000), h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 10px ${c.mono}`;
      ctx.fillStyle = c.scopeText;
      ctx.textBaseline = 'bottom';
      for (let f = 0; f <= nyquist; f += 5000) {
        ctx.textAlign = f === 0 ? 'left' : 'center';
        ctx.fillText(f ? `${f / 1000}k` : '0 Hz', Math.min(w - 12, fx(f) + (f ? 0 : 4)), h - 4);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = c.report;
      ctx.fillText('ULTRASONS', fx(17000) + 6, 6);
      for (const t of tones) {
        ctx.strokeStyle = c.danger;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx(t.freq), 18);
        ctx.lineTo(fx(t.freq), h - 18);
        ctx.stroke();
      }
    }

    if (++frame % 6 === 0) {
      const level = bandLevel(db, sampleRate, fftSize, 17000, Math.min(22000, nyquist));
      $('#u-band', root).textContent = Number.isFinite(level) ? `${Math.round(level)} dB` : '—';
      $('#u-floor', root).textContent = Number.isFinite(floor) ? `${Math.round(floor)} dB` : '—';
      $('#u-sr', root).textContent = `${(sampleRate / 1000).toFixed(1).replace('.', ',')} kHz`;
      $('#u-count', root).textContent = tones.length ? `${tones.length} active${tones.length > 1 ? 's' : ''}` : '';
      const ul = $('#u-list', root);
      ul.innerHTML = tones.length
        ? tones
            .slice(0, 5)
            .map(
              (t) => `<li><span class="kind-badge">${icons.waves}</span><div class="grow"><div class="title mono">${formatFrequency(t.freq)}</div><div class="sub">${toneSource(t.freq)}</div></div><span class="chip" data-tone="${t.freq >= 17000 ? 'danger' : 'warn'}">+${Math.round(t.prominence)} dB</span></li>`,
            )
            .join('')
        : `<li class="empty">Aucune tonalité pour l'instant. Une émission stable au-dessus de 15 kHz apparaîtra ici.</li>`;
    }
  });

  $('#u-toggle', root).addEventListener('click', () => (us.running ? usStop() : usStart()));

  // ───── Wi-Fi ─────
  const wifi = { scanning: false, timer: 0 };
  const netIcons = { camera: icons.camera, iot: icons.chip, hidden: icons.eye, router: icons.wifi };

  function wifiNote() {
    const p = $('#f-note p', root);
    if (isNative || settings.get('demo')) {
      p.innerHTML =
        "<strong>Limite :</strong> seules les caméras qui diffusent leur propre réseau (mode configuration, point d'accès direct) apparaissent ici. Une caméra déjà branchée sur la box de l'hôte reste invisible ; vérifiez alors les appareils connectés dans l'interface de la box. Android autorise 4 analyses toutes les 2 minutes : la liste se met à jour toutes les 35 s.";
    } else {
      p.innerHTML =
        "<strong>Analyse Wi-Fi réservée à l'application Android.</strong> Les navigateurs n'ont pas accès aux réseaux alentour. Installez l'APK Sentinelle (Réglages), ou ouvrez la liste des réseaux de votre téléphone : des noms comme « IPC », « CAM », « HD- », « V380 », « Tapo_C » ou « EZVIZ » doivent attirer l'attention.";
    }
  }

  function renderWifi(list, fresh) {
    const ranked = rankNetworks(list);
    const cams = ranked.filter((n) => n.info.kind === 'camera').length;
    const iot = ranked.filter((n) => n.info.kind === 'iot').length;
    $('#f-summary', root).innerHTML = [
      `<span class="chip" data-tone="accent">${ranked.length} réseau${ranked.length > 1 ? 'x' : ''}</span>`,
      `<span class="chip" data-tone="${cams ? 'danger' : 'ok'}">${cams} caméra${cams > 1 ? 's' : ''} possible${cams > 1 ? 's' : ''}</span>`,
      iot ? `<span class="chip" data-tone="warn">${iot} objet${iot > 1 ? 's' : ''} connecté${iot > 1 ? 's' : ''}</span>` : '',
    ].join('');
    $('#f-count', root).textContent = fresh ? "à l'instant" : 'résultats en mémoire';
    const ul = $('#f-list', root);
    if (!ranked.length) {
      ul.innerHTML = `<li class="empty">Aucun réseau détecté. Vérifiez que le Wi-Fi et la localisation sont activés.</li>`;
      return;
    }
    ul.innerHTML = ranked
      .map((n) => {
        const ch = channel(n.frequency);
        const level = rssiToLevel(n.level);
        const bars = [0.15, 0.4, 0.65, 0.85].map((t) => `<i class="${level >= t ? 'on' : ''}"></i>`).join('');
        const sub = [n.info.vendor, `${band(n.frequency)}${ch ? ` · canal ${ch}` : ''}`, security(n.capabilities), `${n.level} dBm · ${signalLabel(n.level)}`].filter(Boolean).join(' · ');
        const why = n.info.reasons.length ? `<div class="sub">${escapeHtml(n.info.reasons.join(', '))}</div>` : '';
        const chip = n.info.risk === 'low' ? '' : `<div class="tags"><span class="chip" data-tone="${n.info.risk === 'high' ? 'danger' : 'warn'}">${escapeHtml(n.info.label)}</span></div>`;
        return `<li class="device static" data-risk="${n.info.risk}">
          <span class="kind-badge">${netIcons[n.info.kind]}</span>
          <div class="grow"><div class="title">${escapeHtml(n.info.ssid || 'Réseau masqué')}</div>${chip}<div class="sub">${escapeHtml(sub)}</div>${why}</div>
          <span class="bars" aria-hidden="true">${bars}</span>
        </li>`;
      })
      .join('');
  }

  function setScanButton(busy) {
    const b = $('#f-scan', root);
    b.disabled = busy;
    b.innerHTML = busy ? `${icons.wifi}<span>Analyse en cours…</span>` : `${icons.wifi}<span>Analyser les réseaux Wi-Fi</span>`;
  }

  async function wifiScan() {
    if (wifi.scanning) return;
    if (settings.get('demo')) {
      renderWifi(createDemoWifi(), true);
      return;
    }
    if (!isNative) {
      toast("L'analyse Wi-Fi nécessite l'application Android.");
      return;
    }
    wifi.scanning = true;
    setScanButton(true);
    try {
      const perm = await nativeCall('permissions', 'wifi');
      if (!perm?.granted) {
        toast('Autorisez la position précise et « Appareils à proximité » : Android les exige pour lister les réseaux Wi-Fi.', { tone: 'danger', timeout: 6000 });
        return;
      }
      const r = await nativeCall('wifi.scan');
      if (r?.reason === 'location_off') {
        toast('Activez la localisation du téléphone : sans elle, Android ne liste aucun réseau.', { tone: 'danger', timeout: 5000 });
        nativeCall('settings', 'location').catch(() => {});
      }
      renderWifi(r?.results || [], !!r?.fresh);
    } catch {
      toast("L'analyse Wi-Fi a échoué.", { tone: 'danger' });
    } finally {
      wifi.scanning = false;
      setScanButton(false);
    }
  }

  function wifiAuto(on) {
    clearInterval(wifi.timer);
    wifi.timer = 0;
    if (on && (isNative || settings.get('demo'))) {
      wifiScan();
      wifi.timer = setInterval(wifiScan, 35000);
    }
  }

  $('#f-scan', root).addEventListener('click', wifiScan);

  // ───── Onglets ─────
  let currentTab = 'ble';
  function showTab(tab) {
    currentTab = tab;
    root.querySelectorAll('#w-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    $('#w-ble', root).hidden = tab !== 'ble';
    $('#w-wifi', root).hidden = tab !== 'wifi';
    $('#w-us', root).hidden = tab !== 'us';
    if (tab !== 'ble' && ble.running) bleStop();
    if (tab !== 'us' && us.running) usStop();
    wifiAuto(tab === 'wifi');
  }
  $('#w-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  return {
    root,
    mount() {
      ble.meter = hiDpiCanvas($('#b-meter', root));
      us.view = hiDpiCanvas($('#u-fall', root));
      setSupport(supportText());
      wifiNote();
      renderDevices();
      if (currentTab === 'wifi') wifiAuto(true);
    },
    unmount() {
      wifiAuto(false);
      if (ble.running) bleStop();
      if (us.running) usStop();
      ble.meter?.dispose();
      us.view?.dispose();
    },
  };
}
