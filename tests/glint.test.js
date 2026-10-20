import test from 'node:test';
import assert from 'node:assert/strict';
import { GlintTracker, detectGlints, luminance, peakAround, torchVerdict } from '../js/core/glint.js';

// Image synthétique : pièce sombre bruitée, une lampe large et un petit reflet d'objectif.
function scene({ w = 320, h = 240, lens = { x: 200, y: 80 }, lamp = true, seed = 1 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = 30 + (x / w) * 40 + rnd() * 18;
      data[i] = base; data[i + 1] = base; data[i + 2] = base + 6; data[i + 3] = 255;
    }
  }
  const disc = (cx, cy, r, v, tint = [0, 0, 0]) => {
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          const i = (y * w + x) * 4;
          data[i] = v + tint[0]; data[i + 1] = v + tint[1]; data[i + 2] = v + tint[2];
        }
  };
  if (lamp) disc(60, 160, 26, 250);
  if (lens) disc(lens.x, lens.y, 2, 252);
  return { data, w, h };
}

test('détecte le reflet d’objectif et ignore la lampe', () => {
  const { data, w, h } = scene();
  const found = detectGlints(data, w, h, { sensitivity: 0.6 });
  assert.ok(found.length >= 1, 'au moins une détection');
  const best = found[0];
  assert.ok(Math.abs(best.x - 200) < 2 && Math.abs(best.y - 80) < 2, `position ${best.x},${best.y}`);
  assert.ok(!found.some((f) => Math.hypot(f.x - 60, f.y - 160) < 30), 'la lampe est écartée');
});

test('rien à signaler dans une pièce vide', () => {
  const { data, w, h } = scene({ lens: null, lamp: false });
  assert.equal(detectGlints(data, w, h, { sensitivity: 0.6 }).length, 0);
});

test('le suivi confirme un reflet stable et oublie un reflet fugace', () => {
  const tracker = new GlintTracker({ minHits: 4 });
  for (let f = 0; f < 6; f++) {
    const { data, w, h } = scene({ lens: { x: 200 + (f % 2), y: 80 }, seed: f + 3 });
    tracker.update(detectGlints(data, w, h), w);
  }
  assert.equal(tracker.confirmed().length, 1);
  for (let f = 0; f < 8; f++) tracker.update([], 320);
  assert.equal(tracker.tracks.length, 0);
});

test('contrôle flash et luminance locale', () => {
  assert.equal(torchVerdict(250, 60), 'reflet');
  assert.equal(torchVerdict(250, 240), 'source');
  const { data, w, h } = scene();
  const luma = luminance(data, w, h);
  assert.ok(peakAround(luma, w, h, 200, 80) >= 245);
});

test('les LED voisines forment un seul appareil', async () => {
  const { clusterTracks } = await import('../js/core/glint.js');
  const ring = Array.from({ length: 6 }, (_, i) => ({ id: i, x: 100 + Math.cos(i) * 12, y: 80 + Math.sin(i) * 12, radius: 2, hits: 5, confidence: 0.5 + i / 20, confirmed: true, verdict: null }));
  const lone = { id: 9, x: 250, y: 200, radius: 2, hits: 3, confidence: 0.4, confirmed: false, verdict: 'source' };
  const groups = clusterTracks([...ring, lone], 26);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.count === 6);
  assert.ok(Math.abs(g.x - 100) < 3 && g.confirmed && g.confidence === 0.75);
  assert.equal(groups.find((x) => x.count === 1).verdict, 'source');
});
