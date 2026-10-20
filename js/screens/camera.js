import { chime, unlockAudio, vibrate } from '../core/audio.js';
import { GlintTracker, clusterTracks, detectGlints, luminance, peakAround, torchVerdict } from '../core/glint.js';
import { icons } from '../core/icons.js';
import { settings } from '../core/store.js';
import { $, el, hiDpiCanvas, themeColors, toast } from '../core/ui.js';
import { drawDemoIr, drawDemoRoom } from '../sim/demo.js';

const WORK_WIDTH = 320;
const MODES = {
  lens: {
    label: "Reflet d'objectif",
    facing: 'environment',
    tip: "Lumière éteinte, flash allumé, balayez lentement la pièce à 1–3 m. Un objectif renvoie un petit point très brillant qui reste fixe quand vous bougez légèrement.",
  },
  ir: {
    label: 'Infrarouge',
    facing: 'user',
    tip: "Dans le noir complet, pointez la caméra avant vers les objets suspects. Les LED infrarouges de vision nocturne apparaissent en points violets ou blancs, invisibles à l'œil nu.",
  },
};

export function cameraScreen() {
  const root = el(`
    <section class="screen" aria-labelledby="c-title">
      <div class="screen-head">
        <span class="eyebrow">Caméras cachées</span>
        <h1 id="c-title">Détecteur d'objectifs</h1>
        <p>Analyse l'image en direct pour repérer le reflet des objectifs et les LED infrarouges des caméras de vision nocturne.</p>
      </div>

      <div class="seg" id="c-mode" role="group" aria-label="Méthode de détection">
        <button type="button" data-mode="lens" aria-pressed="true">${MODES.lens.label}</button>
        <button type="button" data-mode="ir" aria-pressed="false">${MODES.ir.label}</button>
      </div>

      <div class="viewport" id="c-view">
        <div class="viewport-idle" id="c-idle">
          ${icons.camera}
          <p id="c-idle-text">${MODES.lens.tip}</p>
          <button class="btn btn-primary" id="c-start" type="button">${icons.play}<span>Lancer l'analyse</span></button>
        </div>
        <video id="c-video" playsinline muted hidden></video>
        <canvas class="demo-feed" id="c-demo" hidden></canvas>
        <canvas class="overlay" id="c-overlay" hidden></canvas>
        <div class="reticle" id="c-reticle" hidden></div>
        <div class="viewport-hud" id="c-hud" hidden>
          <span class="hud-pill" id="c-fps">— im/s</span>
          <span class="hud-pill" id="c-count">0 suspect</span>
        </div>
      </div>

      <div class="cam-tools">
        <button class="tool" id="c-torch" type="button" aria-pressed="false" disabled>${icons.flash}<span>Flash</span></button>
        <button class="tool" id="c-filter" type="button" aria-pressed="false" disabled>${icons.filter}<span>Filtre rouge</span></button>
        <button class="tool" id="c-verify" type="button" disabled>${icons.target}<span>Contrôle flash</span></button>
        <button class="tool" id="c-stop" type="button" disabled>${icons.stop}<span>Arrêter</span></button>
      </div>

      <div class="panel">
        <div class="slider-row">
          <label for="c-sens" class="small muted">Sensibilité</label>
          <input type="range" id="c-sens" min="0" max="1" step="0.05">
          <span class="mono small" id="c-sens-val"></span>
        </div>
      </div>

      <div class="panel">
        <div class="section-title"><h2>Points suspects</h2><span class="small muted" id="c-summary"></span></div>
        <ul class="list" id="c-list"><li class="empty">Lancez l'analyse : chaque reflet persistant sera listé ici avec son indice de confiance.</li></ul>
      </div>

      <div class="note">${icons.info}
        <p><strong>Où regarder :</strong> détecteurs de fumée, réveils, chargeurs USB, prises, cadres, miroirs, bouches d'aération, box TV, peluches, plantes. <strong>Contrôle flash :</strong> l'application coupe la lampe une fraction de seconde ; un reflet d'objectif disparaît alors qu'une LED ou une lampe reste allumée. Le flash n'est pilotable que sur Android (Chrome) ; sur iPhone, éclairez avec une autre lampe.</p>
      </div>
    </section>`);

  const video = $('#c-video', root);
  const overlay = $('#c-overlay', root);
  const demoCanvas = $('#c-demo', root);
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const tracker = new GlintTracker();
  const st = {
    mode: 'lens',
    running: false,
    demo: false,
    stream: null,
    track: null,
    torch: false,
    torchSupported: false,
    verifying: false,
    lastProcess: 0,
    frames: 0,
    fpsAt: performance.now(),
    fps: 0,
    luma: null,
    confirmedBefore: 0,
    raf: 0,
    vfc: 0,
  };
  let overlayView = null;
  let demoView = null;

  const sensInput = $('#c-sens', root);
  const syncSens = () => {
    sensInput.value = settings.get('sensitivity');
    $('#c-sens-val', root).textContent = `${Math.round(settings.get('sensitivity') * 100)} %`;
  };
  sensInput.addEventListener('input', () => {
    settings.set('sensitivity', Number(sensInput.value));
    syncSens();
  });

  function setMode(mode) {
    if (st.mode === mode) return;
    st.mode = mode;
    root.querySelectorAll('#c-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#c-idle-text', root).textContent = MODES[mode].tip;
    tracker.reset();
    if (st.running) {
      stop();
      start();
    }
  }

  function showRunning(on) {
    $('#c-idle', root).hidden = on;
    video.hidden = !on || st.demo;
    demoCanvas.hidden = !on || !st.demo;
    overlay.hidden = !on;
    $('#c-reticle', root).hidden = !on;
    $('#c-hud', root).hidden = !on;
    $('#c-filter', root).disabled = !on;
    $('#c-stop', root).disabled = !on;
    $('#c-torch', root).disabled = !on || !(st.torchSupported || st.demo);
    $('#c-verify', root).disabled = !on || !(st.torchSupported || st.demo);
  }

  async function start() {
    unlockAudio();
    st.demo = settings.get('demo');
    tracker.reset();
    st.confirmedBefore = 0;
    if (st.demo) {
      st.running = true;
      st.torchSupported = st.mode === 'lens';
      st.torch = st.mode === 'lens';
      showRunning(true);
      demoView = hiDpiCanvas(demoCanvas);
      afterStart();
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast('La caméra exige une page sécurisée (https) et un navigateur récent.', { tone: 'danger', timeout: 5000 });
      return;
    }
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: MODES[st.mode].facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (e) {
      const msg = {
        NotAllowedError: "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur pour ce site.",
        NotFoundError: 'Aucune caméra trouvée sur cet appareil.',
        NotReadableError: 'La caméra est déjà utilisée par une autre application.',
      }[e.name] || "Impossible d'ouvrir la caméra.";
      toast(msg, { tone: 'danger', timeout: 5000 });
      return;
    }
    st.track = st.stream.getVideoTracks()[0];
    st.torchSupported = !!st.track.getCapabilities?.().torch;
    video.srcObject = st.stream;
    await video.play().catch(() => {});
    st.running = true;
    showRunning(true);
    if (st.mode === 'lens' && st.torchSupported) await setTorch(true);
    afterStart();
  }

  function afterStart() {
    overlayView = hiDpiCanvas(overlay);
    $('#c-torch', root).setAttribute('aria-pressed', String(st.torch));
    if (st.mode === 'lens' && !st.torchSupported && !st.demo) toast("Flash non pilotable ici : éclairez la pièce avec une lampe tenue près de l'objectif.", { timeout: 5000 });
    schedule();
  }

  function stop() {
    st.running = false;
    cancelAnimationFrame(st.raf);
    if (st.vfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(st.vfc);
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    st.track = null;
    st.torch = false;
    video.srcObject = null;
    overlayView?.dispose?.();
    demoView?.dispose?.();
    showRunning(false);
    $('#c-torch', root).setAttribute('aria-pressed', 'false');
  }

  async function setTorch(on) {
    if (st.demo) {
      st.torch = on;
    } else if (st.track && st.torchSupported) {
      try {
        await st.track.applyConstraints({ advanced: [{ torch: on }] });
        st.torch = on;
      } catch {
        st.torchSupported = false;
      }
    }
    $('#c-torch', root).setAttribute('aria-pressed', String(st.torch));
  }

  function schedule() {
    if (!st.running) return;
    if (!st.demo && video.requestVideoFrameCallback) st.vfc = video.requestVideoFrameCallback(() => tick());
    else st.raf = requestAnimationFrame(() => tick());
  }

  // Capture une image réduite dans le canvas de travail.
  function grab(now) {
    if (st.demo) {
      const dw = demoView?.width || 300;
      const dh = demoView?.height || 400;
      const h = Math.round((WORK_WIDTH * dh) / dw);
      if (work.width !== WORK_WIDTH || work.height !== h) {
        work.width = WORK_WIDTH;
        work.height = h;
      }
      const draw = st.mode === 'ir' ? drawDemoIr : drawDemoRoom;
      draw(wctx, work.width, work.height, now, { torch: st.torch });
      if (demoView?.ctx) draw(demoView.ctx, dw, dh, now, { torch: st.torch });
      return true;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const h = Math.round((WORK_WIDTH * vh) / vw);
    if (work.width !== WORK_WIDTH || work.height !== h) {
      work.width = WORK_WIDTH;
      work.height = h;
    }
    wctx.drawImage(video, 0, 0, work.width, work.height);
    return true;
  }

  function tick() {
    if (!st.running) return;
    const now = performance.now();
    if (!st.verifying && now - st.lastProcess >= 45 && grab(now)) {
      st.lastProcess = now;
      const img = wctx.getImageData(0, 0, work.width, work.height);
      st.luma = luminance(img.data, work.width, work.height, st.luma?.length === work.width * work.height ? st.luma : undefined);
      const found = detectGlints(img.data, work.width, work.height, { sensitivity: settings.get('sensitivity'), mode: st.mode, luma: st.luma });
      tracker.update(found, work.width);
      st.frames++;
      if (now - st.fpsAt > 1000) {
        st.fps = Math.round((st.frames * 1000) / (now - st.fpsAt));
        st.frames = 0;
        st.fpsAt = now;
        $('#c-fps', root).textContent = `${st.fps} im/s · ${work.width}×${work.height}`;
      }
      report();
    }
    drawOverlay(now);
    schedule();
  }

  // Passage des coordonnées de travail aux coordonnées affichées (object-fit: cover).
  function mapper() {
    const vw = overlayView.width;
    const vh = overlayView.height;
    if (st.demo) return (x, y) => [(x * vw) / work.width, (y * vh) / work.height, vw / work.width];
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    const scale = Math.max(vw / sw, vh / sh);
    const ox = (vw - sw * scale) / 2;
    const oy = (vh - sh * scale) / 2;
    const k = (sw / work.width) * scale;
    return (x, y) => [ox + x * k, oy + y * k, k];
  }

  function drawOverlay(now) {
    if (!overlayView?.ctx || !work.width) return;
    const { ctx, width, height } = overlayView;
    ctx.clearRect(0, 0, width, height);
    const c = themeColors();
    const map = mapper();
    for (const t of groups(tracker.tracks.filter((tr) => tr.hits >= 2))) {
      const [x, y, k] = map(t.x, t.y);
      const r = Math.max(14, t.radius * k * (t.count > 1 ? 1.4 : 3));
      const color = t.verdict === 'source' ? c.muted : t.confirmed ? c.danger : c.warn;
      ctx.strokeStyle = color;
      ctx.lineWidth = t.confirmed ? 2.5 : 1.5;
      const L = r * 0.5;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * r, y + sy * (r - L));
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * (r - L), y + sy * r);
      }
      ctx.stroke();
      if (t.confirmed && t.verdict !== 'source') {
        const pulse = (now % 900) / 900;
        ctx.globalAlpha = 1 - pulse;
        ctx.beginPath();
        ctx.arc(x, y, r * (0.6 + pulse * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const pct = `${Math.round(t.confidence * 100)} %`;
      const what = t.count > 1 ? `${t.count} ${st.mode === 'ir' ? 'LED IR' : 'points'} · ` : '';
      const label = t.verdict === 'source' ? 'Source lumineuse' : t.verdict === 'reflet' ? `Objectif ${pct}` : `${what}${pct}`;
      ctx.font = `600 12px ${c.mono}`;
      const tw = ctx.measureText(label).width + 10;
      const lx = Math.min(width - tw - 4, Math.max(4, x - tw / 2));
      const ly = Math.max(4, y - r - 22);
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, tw, 18);
      ctx.fillStyle = c.bg;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 5, ly + 9.5);
    }
  }

  // Points voisins regroupés, à l'échelle de l'image de travail.
  const groups = (tracks) => clusterTracks(tracks, work.width * 0.08);

  function report() {
    const confirmed = groups(tracker.confirmed()).filter((t) => t.verdict !== 'source');
    const n = confirmed.length;
    const pill = $('#c-count', root);
    pill.textContent = `${n} suspect${n > 1 ? 's' : ''}`;
    pill.classList.toggle('alert', n > 0);
    if (n > st.confirmedBefore) {
      chime('found');
      vibrate([60, 40, 60]);
    }
    st.confirmedBefore = n;
    $('#c-summary', root).textContent = n ? `${n} à vérifier de près` : 'Aucun pour le moment';
    const list = $('#c-list', root);
    const items = groups(tracker.confirmed()).sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    if (!items.length) {
      list.innerHTML = `<li class="empty">${st.mode === 'lens' ? 'Balayez lentement : un reflet doit tenir plusieurs images pour être retenu.' : 'Aucune LED infrarouge repérée. Faites le noir complet.'}</li>`;
      return;
    }
    list.innerHTML = items
      .map((t) => {
        const pct = Math.round(t.confidence * 100);
        const where = `${t.x < work.width / 3 ? 'à gauche' : t.x > (work.width * 2) / 3 ? 'à droite' : 'au centre'}, ${t.y < work.height / 3 ? 'en haut' : t.y > (work.height * 2) / 3 ? 'en bas' : 'à mi-hauteur'}`;
        const verdict =
          t.verdict === 'reflet'
            ? 'Reflet confirmé par le contrôle flash'
            : t.verdict === 'source'
              ? 'Source lumineuse (LED, lampe) : probablement sans danger'
              : st.mode === 'ir'
                ? t.count > 2
                  ? `Anneau de ${t.count} LED infrarouges : caméra de vision nocturne probable`
                  : 'Point infrarouge persistant'
                : 'Reflet persistant, à inspecter';
        const tone = t.verdict === 'source' ? '' : pct >= 60 ? 'danger' : 'warn';
        return `<li><span class="kind-badge">${icons.target}</span><div class="grow"><div class="title">${verdict}</div><div class="sub">Image ${where} · vu ${t.hits} fois</div></div><span class="chip" data-tone="${tone}">${pct} %</span></li>`;
      })
      .join('');
  }

  async function verify() {
    const tracks = tracker.confirmed();
    if (!tracks.length) {
      toast("Aucun point confirmé à vérifier : visez d'abord un reflet.");
      return;
    }
    if (!st.torch) await setTorch(true);
    // Mesure au plus près du point : un voisinage trop large capterait l'objet qui entoure l'objectif.
    const radius = (t) => Math.max(1, Math.round(t.radius));
    const before = tracks.map((t) => peakAround(st.luma, work.width, work.height, t.x, t.y, radius(t)));
    st.verifying = true;
    await setTorch(false);
    await new Promise((r) => setTimeout(r, st.demo ? 120 : 450));
    grab(performance.now());
    const img = wctx.getImageData(0, 0, work.width, work.height);
    const off = luminance(img.data, work.width, work.height);
    tracks.forEach((t, i) => (t.verdict = torchVerdict(before[i], peakAround(off, work.width, work.height, t.x, t.y, radius(t)))));
    await setTorch(true);
    st.verifying = false;
    const lenses = tracks.filter((t) => t.verdict === 'reflet').length;
    toast(lenses ? `${lenses} reflet(s) d'objectif probable(s) : approchez-vous pour inspecter.` : 'Ce sont des sources lumineuses, pas des objectifs.', { tone: lenses ? 'danger' : 'info' });
    report();
  }

  $('#c-start', root).addEventListener('click', start);
  $('#c-stop', root).addEventListener('click', stop);
  $('#c-mode', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#c-torch', root).addEventListener('click', () => setTorch(!st.torch));
  $('#c-filter', root).addEventListener('click', (e) => {
    const on = !$('#c-view', root).classList.contains('filter-red');
    $('#c-view', root).classList.toggle('filter-red', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  $('#c-verify', root).addEventListener('click', verify);

  return {
    root,
    mount() {
      syncSens();
    },
    unmount() {
      if (st.running) stop();
    },
  };
}
