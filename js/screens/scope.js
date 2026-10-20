// Écran radar circulaire : anneaux de distance, balayage, échos par catégorie.
// Orientation « cap en haut » : le sens de marche pointe toujours vers le haut.
import { formatDistance, normalizeAngle, toLocalXY } from '../core/geo.js';
import { CATEGORIES } from '../core/radar-logic.js';
import { animationLoop, hiDpiCanvas, themeColors } from '../core/ui.js';

export function categoryColor(cat, c = themeColors()) {
  return { fixed: c.danger, mobile: c.danger, section: c.warn, redlight: c.warn, reported: c.report, surveillance: c.scopeSweep }[cat] || c.accent;
}

function drawShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  switch (shape) {
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.95, y + r * 0.75);
      ctx.lineTo(x - r * 0.95, y + r * 0.75);
      break;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      break;
    case 'square':
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const rr = i % 2 ? r * 0.45 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      break;
    default:
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
  }
  ctx.closePath();
}

// Halo pré-rendu : bien plus rapide que shadowBlur à chaque image.
const glowCache = new Map();
function glowSprite(color, size) {
  const key = `${color}|${size}`;
  if (glowCache.has(key)) return glowCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size, size, 0, size, size, size);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'transparent');
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  g.fillRect(0, 0, size * 2, size * 2);
  glowCache.set(key, c);
  return c;
}

export function createScope(canvas, getState) {
  let view = { ctx: null, width: 0, height: 0 };
  const lastSweepHit = new Map();
  const onTheme = () => glowCache.clear();
  window.addEventListener('hiram:theme', onTheme);
  view = hiDpiCanvas(canvas);

  const SWEEP_PERIOD = 3600;

  const draw = (t) => {
    const { ctx, width: w, height: h } = view;
    if (!w) return;
    const c = themeColors();
    const st = getState();
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 2;
    const range = st.range;
    const heading = st.heading ?? 0;
    const sweep = ((t % SWEEP_PERIOD) / SWEEP_PERIOD) * Math.PI * 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.scopeBg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Anneaux de distance.
    ctx.strokeStyle = c.scopeRing;
    ctx.lineWidth = 1;
    ctx.font = `600 ${Math.max(10, R * 0.045)}px ${c.mono}`;
    ctx.fillStyle = c.scopeText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= 4; i++) {
      const rr = (R * i) / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(formatDistance((range * i) / 4), cx + 6, cy - rr + 11);
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Graduations de cap tous les 10°, repère du nord.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-heading * Math.PI) / 180);
    for (let d = 0; d < 360; d += 10) {
      const major = d % 30 === 0;
      ctx.rotate((10 * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(0, -R + (major ? 9 : 5));
      ctx.stroke();
    }
    ctx.restore();
    const nAngle = (-heading * Math.PI) / 180 - Math.PI / 2;
    const nx = cx + Math.cos(nAngle) * (R - 20);
    const ny = cy + Math.sin(nAngle) * (R - 20);
    ctx.font = `700 ${Math.max(12, R * 0.06)}px ${c.display}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = c.danger;
    ctx.fillText('N', nx, ny);

    // Faisceau de balayage avec traînée.
    if (st.running) {
      ctx.save();
      ctx.translate(cx, cy);
      if (ctx.createConicGradient) {
        const cg = ctx.createConicGradient(sweep - Math.PI / 2 - 0.9, 0, 0);
        cg.addColorStop(0, 'transparent');
        cg.addColorStop(0.143, `${c.scopeSweep}55`);
        cg.addColorStop(0.144, 'transparent');
        cg.addColorStop(1, 'transparent');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = c.scopeSweep;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sweep - Math.PI / 2) * R, Math.sin(sweep - Math.PI / 2) * R);
      ctx.stroke();
      ctx.restore();
    }

    // Échos.
    const scale = R / range;
    const alertId = st.alert?.point.id;
    for (const th of st.threats) {
      if (th.distance > range * 1.02) continue;
      const p = th.point;
      const cat = CATEGORIES[p.category];
      if (st.dangerZones && cat.road) continue;
      const { x, y } = toLocalXY(st.pos, p);
      // Rotation de +cap : un point situé dans l'axe de marche se retrouve en haut.
      const a = (heading * Math.PI) / 180;
      const rx = x * Math.cos(a) - y * Math.sin(a);
      const ry = x * Math.sin(a) + y * Math.cos(a);
      const px = cx + rx * scale;
      const py = cy - ry * scale;
      // L'écho s'illumine au passage du faisceau puis s'estompe.
      const angle = normalizeAngle((Math.atan2(rx, ry) * 180) / Math.PI);
      const sweepDeg = (sweep * 180) / Math.PI;
      if (Math.abs(((sweepDeg - angle + 540) % 360) - 180) < 4) lastSweepHit.set(p.id, t);
      const age = (t - (lastSweepHit.get(p.id) ?? t - SWEEP_PERIOD)) / SWEEP_PERIOD;
      const glow = st.running ? Math.max(0.45, 1 - age * 0.7) : 0.85;
      const color = categoryColor(p.category, c);
      const size = Math.max(5, R * 0.032) * (p.id === alertId ? 1.35 : 1);
      ctx.globalAlpha = glow;
      ctx.drawImage(glowSprite(color, 24), px - size * 2.4, py - size * 2.4, size * 4.8, size * 4.8);
      ctx.fillStyle = color;
      drawShape(ctx, cat.shape, px, py, size);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (p.id === alertId) {
        const pulse = (t % 1000) / 1000;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - pulse;
        ctx.beginPath();
        ctx.arc(px, py, size * (1.6 + pulse * 2.4), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Zone de danger : secteur coloré devant le véhicule, sans position précise.
    if (st.dangerZones && st.alert) {
      ctx.save();
      ctx.translate(cx, cy);
      const pulse = 0.25 + 0.15 * Math.sin(t / 250);
      ctx.fillStyle = c.warn;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Véhicule au centre, précision GPS en halo.
    if (st.pos) {
      const acc = Math.min(R, (st.accuracy || 0) * scale);
      if (acc > 4) {
        ctx.fillStyle = c.scopeSweep;
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.arc(cx, cy, acc, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    const s = Math.max(9, R * 0.05);
    // L'écran radar reste sombre dans les deux thèmes : couleur dédiée, pas celle du texte.
    ctx.fillStyle = st.pos ? c.scopeInk : c.scopeText;
    ctx.strokeStyle = c.scopeBg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 1.2);
    ctx.lineTo(cx + s * 0.85, cy + s * 0.9);
    ctx.lineTo(cx, cy + s * 0.4);
    ctx.lineTo(cx - s * 0.85, cy + s * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (!st.pos) {
      ctx.fillStyle = c.scopeText;
      ctx.font = `600 ${Math.max(12, R * 0.055)}px ${c.display}`;
      ctx.textAlign = 'center';
      ctx.fillText(st.running ? 'Recherche du signal GPS…' : 'Surveillance à l’arrêt', cx, cy + R * 0.3);
    }
  };

  const loop = animationLoop(draw);
  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    drawOnce: () => draw(performance.now()),
    dispose() {
      loop.stop();
      view.dispose?.();
      window.removeEventListener('hiram:theme', onTheme);
    },
  };
}
