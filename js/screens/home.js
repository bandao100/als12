import { icons } from '../core/icons.js';
import { capabilities, permissionState } from '../core/sensors.js';
import { readJSON, settings, writeJSON } from '../core/store.js';
import { $, animationLoop, el, hiDpiCanvas, themeColors } from '../core/ui.js';
import { radarService } from '../services/radar-service.js';

const CHECK_KEY = 'sentinelle:checklist:v1';

const STEPS = [
  ['Faites le noir', 'Fermez rideaux et volets, éteignez toutes les lumières de la pièce.'],
  ['Balayage infrarouge', 'Caméras › Infrarouge : passez la caméra avant sur les murs, le plafond et les meubles.'],
  ['Balayage au flash', 'Caméras › Reflet : visez détecteurs de fumée, réveils, chargeurs, cadres, prises, box TV et peluches.'],
  ['Contrôle flash', 'Sur chaque point suspect, lancez le contrôle flash pour écarter les simples LED.'],
  ['Test du miroir', "Posez l'ongle contre le miroir : s'il ne reste aucun espace entre l'ongle et son reflet, méfiez-vous d'un miroir sans tain."],
  ['Scan Bluetooth', 'Ondes › Bluetooth : repérez caméras et traceurs, puis pistez-les pour les localiser.'],
  ['Réseaux Wi-Fi', 'Dans les réglages Wi-Fi du téléphone, cherchez des noms de caméras : IPC, CAM, HD-, YI, Tapo, EZVIZ, Hikvision.'],
  ['Champ magnétique', "Champs : approchez le téléphone des objets suspects ; un pic net trahit de l'électronique alimentée."],
];

const DETECTION = [
  ['Radars routiers (24–35 GHz)', 'Non, aucun téléphone', 'Positions connues OpenStreetMap et vos signalements'],
  ['Objectifs de caméra', 'Oui', 'Rétro-réflexion du flash, suivie image par image'],
  ['LED infrarouges (850–940 nm)', 'Souvent', 'Caméra avant, rarement filtrée en infrarouge'],
  ['Bluetooth (2,4 GHz)', 'Oui, Chrome Android', 'Annonces BLE et puissance du signal'],
  ['Wi-Fi (2,4 / 5 / 6 GHz)', { web: 'Pas depuis le Web', app: 'Oui, application Android' }, "Points d'accès de caméras : nom du réseau et fabricant"],
  ['GSM / 4G (micros espions)', 'Non', 'Détecteur RF dédié nécessaire'],
  ['Champs magnétiques', 'Oui', 'Magnétomètre (capteur de la boussole)'],
  ['Ultrasons (17–24 kHz)', 'En partie', "Micro, jusqu'à 20–22 kHz selon le modèle"],
];

export function homeScreen() {
  const root = el(`
    <section class="screen" aria-labelledby="h-title">
      <div class="hero">
        <div>
          <span class="eyebrow">Détecteur de poche</span>
          <h1 id="h-title">Voyez ce qui <em>vous observe</em>.</h1>
          <p>Radars routiers, caméras cachées, traceurs Bluetooth, champs magnétiques et ultrasons : quatre détecteurs qui tirent le meilleur des capteurs de votre téléphone, sans rien envoyer sur Internet.</p>
        </div>
        <canvas id="h-scope" aria-hidden="true"></canvas>
      </div>

      <div class="sensor-strip" id="h-sensors" aria-label="Capteurs de cet appareil"></div>

      <div class="modules">
        <a class="module" href="#radars">
          <span class="module-icon">${icons.radar}</span>
          <h3>Radars routiers</h3>
          <p>Alerte vocale avant chaque radar fixe, feu rouge ou tronçon, selon votre vitesse.</p>
          <span class="chip" id="h-radar-status">Prêt</span>
        </a>
        <a class="module" href="#cameras">
          <span class="module-icon">${icons.camera}</span>
          <h3>Caméras cachées</h3>
          <p>Reflet des objectifs au flash et LED infrarouges de vision nocturne.</p>
          <span class="chip" id="h-cam-status">Caméra</span>
        </a>
        <a class="module" href="#champs">
          <span class="module-icon">${icons.magnet}</span>
          <h3>Champs magnétiques</h3>
          <p>Écart au champ terrestre en µT : électronique alimentée, aimants, transformateurs.</p>
          <span class="chip" id="h-emf-status">Magnétomètre</span>
        </a>
        <a class="module" href="#ondes">
          <span class="module-icon">${icons.waves}</span>
          <h3>Radio et ultrasons</h3>
          <p>Traceurs AirTag, SmartTag ou Tile, réseaux Wi-Fi de caméras et émissions ultrasonores.</p>
          <span class="chip" id="h-waves-status">Bluetooth</span>
        </a>
      </div>

      <div class="panel">
        <div class="section-title">
          <h2>Inspecter une chambre</h2>
          <button class="btn btn-ghost" id="h-reset" type="button" style="min-height:34px;padding:0 12px">Recommencer</button>
        </div>
        <p class="small muted" id="h-progress-label" style="margin-top:4px"></p>
        <div class="progress" style="margin-top:8px"><span id="h-progress"></span></div>
        <ol class="list checklist" id="h-steps">
          ${STEPS.map(
            ([t, d], i) => `<li data-step="${i}" role="checkbox" tabindex="0" aria-checked="false"><span class="check-num">${i + 1}</span><div class="grow"><div class="title">${t}</div><div class="sub">${d}</div></div></li>`,
          ).join('')}
        </ol>
      </div>

      <div class="section-title"><h2>Ce que votre téléphone peut détecter</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Signal</th><th>Détectable</th><th>Méthode</th></tr></thead>
          <tbody>${DETECTION.map(([a, b, c]) => `<tr><td>${a}</td><td><strong>${typeof b === 'string' ? b : capabilities().native ? b.app : b.web}</strong></td><td class="muted">${c}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`);

  let done = new Set(readJSON(CHECK_KEY, []));
  function renderSteps() {
    root.querySelectorAll('#h-steps li').forEach((li) => {
      const on = done.has(Number(li.dataset.step));
      li.classList.toggle('done', on);
      li.setAttribute('aria-checked', String(on));
    });
    $('#h-progress', root).style.width = `${(done.size / STEPS.length) * 100}%`;
    $('#h-progress-label', root).textContent =
      done.size === STEPS.length ? 'Inspection terminée. Gardez un œil sur tout objet qui aurait changé de place.' : `${done.size} étape${done.size > 1 ? 's' : ''} sur ${STEPS.length} · touchez une étape pour la cocher.`;
  }
  const toggleStep = (li) => {
    const i = Number(li.dataset.step);
    if (done.has(i)) done.delete(i);
    else done.add(i);
    writeJSON(CHECK_KEY, [...done]);
    renderSteps();
  };
  $('#h-steps', root).addEventListener('click', (e) => {
    const li = e.target.closest('li[data-step]');
    if (li) toggleStep(li);
  });
  $('#h-steps', root).addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-step]');
    if (li && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      toggleStep(li);
    }
  });
  $('#h-reset', root).addEventListener('click', () => {
    done = new Set();
    writeJSON(CHECK_KEY, []);
    renderSteps();
  });

  async function renderSensors() {
    const cap = capabilities();
    const demo = settings.get('demo');
    const geo = cap.geolocation ? await permissionState('geolocation') : 'absent';
    const chip = (tone, label) => `<span class="chip" data-tone="${tone}">${label}</span>`;
    const chips = [];
    if (demo) chips.push(chip('report', 'Mode démo actif'));
    if (cap.native) chips.push(chip('accent', `Application Android${cap.model ? ` · ${cap.model}` : ''}`));
    if (!cap.secure) chips.push(chip('danger', 'Page non sécurisée : capteurs bloqués'));
    chips.push(geo === 'absent' ? chip('danger', 'GPS absent') : geo === 'denied' ? chip('danger', 'GPS refusé') : chip(geo === 'granted' ? 'ok' : 'accent', geo === 'granted' ? 'GPS autorisé' : 'GPS disponible'));
    chips.push(chip(cap.camera ? 'ok' : 'danger', cap.camera ? 'Caméra' : 'Caméra absente'));
    chips.push(chip(cap.magnetometer ? 'ok' : 'warn', cap.magnetometer ? 'Magnétomètre' : 'Magnétomètre à activer'));
    chips.push(chip(cap.bleScan ? 'ok' : cap.bluetooth ? 'warn' : 'danger', cap.bleScan ? 'Scan Bluetooth' : cap.bluetooth ? 'Bluetooth limité' : 'Bluetooth absent'));
    if (cap.native) chips.push(chip(cap.wifiScan ? 'ok' : 'danger', cap.wifiScan ? 'Scan Wi-Fi' : 'Wi-Fi absent'));
    if (cap.compass) chips.push(chip('ok', 'Boussole'));
    chips.push(chip(cap.microphone ? 'ok' : 'danger', cap.microphone ? 'Micro' : 'Micro absent'));
    $('#h-sensors', root).innerHTML = chips.join('');

    const set = (id, tone, label) => {
      const n = $(id, root);
      n.dataset.tone = tone;
      n.textContent = label;
    };
    set('#h-cam-status', demo || cap.camera ? 'ok' : 'danger', demo ? 'Démo' : cap.camera ? 'Caméra prête' : 'Caméra absente');
    set('#h-emf-status', demo || cap.magnetometer ? 'ok' : 'warn', demo ? 'Démo' : cap.magnetometer ? 'Capteur prêt' : 'Capteur à activer');
    set('#h-waves-status', demo || cap.bleScan ? 'ok' : cap.bluetooth || cap.microphone ? 'warn' : 'danger', demo ? 'Démo' : cap.wifiScan ? 'Bluetooth et Wi-Fi' : cap.bleScan ? 'Scan complet' : cap.bluetooth ? 'Bluetooth limité' : cap.microphone ? 'Ultrasons seuls' : 'Indisponible');
    renderRadar();
  }

  function renderRadar() {
    const s = radarService.state;
    const n = $('#h-radar-status', root);
    n.classList.toggle('live', s.running);
    if (s.alert) {
      n.dataset.tone = 'danger';
      n.textContent = 'Alerte en cours';
    } else if (s.running) {
      n.dataset.tone = 'ok';
      n.textContent = `Surveillance active · ${radarService.points.length} points`;
    } else {
      n.dataset.tone = 'accent';
      n.textContent = 'Prêt';
    }
  }

  // Petit radar décoratif de l'en-tête.
  let mini = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const loop = animationLoop((t) => {
    if (!mini?.width) return;
    const { ctx, width: w, height: h } = mini;
    const c = themeColors();
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.scopeBg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.scopeRing;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const a = reduce.matches ? -0.6 : ((t % 3200) / 3200) * Math.PI * 2 - Math.PI / 2;
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(a - 1.2, cx, cy);
      g.addColorStop(0, 'transparent');
      g.addColorStop(0.19, `${c.scopeSweep}66`);
      g.addColorStop(0.191, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = c.scopeSweep;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
    const blips = [[0.55, -0.8, c.danger], [0.35, 2.2, c.warn], [0.8, 1.1, c.scopeSweep]];
    for (const [r, ang, col] of blips) {
      const d = ((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      ctx.globalAlpha = reduce.matches ? 1 : Math.max(0.25, 1 - d / 4);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * R * r, cy + Math.sin(ang) * R * r, Math.max(2.5, R * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  const onSettings = (key) => key === 'demo' && renderSensors();
  let unsub = null;
  return {
    root,
    mount() {
      mini = hiDpiCanvas($('#h-scope', root));
      loop.start();
      renderSteps();
      renderSensors();
      radarService.addEventListener('update', renderRadar);
      unsub = settings.subscribe(onSettings);
    },
    unmount() {
      loop.stop();
      mini?.dispose();
      radarService.removeEventListener('update', renderRadar);
      unsub?.();
    },
  };
}
