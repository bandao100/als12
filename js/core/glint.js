// Détection optique des objectifs de caméra.
//
// Un objectif renvoie la lumière du flash vers sa source (rétro-réflexion) :
// on cherche des points petits, compacts et beaucoup plus lumineux que leur
// voisinage immédiat. Les lampes et fenêtres, trop grandes ou trop diffuses,
// sont écartées par la taille et par le contraste local.

export function sensitivityParams(sensitivity = 0.6, mode = 'lens') {
  const s = Math.min(1, Math.max(0, sensitivity));
  if (mode === 'ir') {
    return { minLuma: 225 - s * 85, percentile: 0.995, minContrast: 2.4 - s * 1.0, maxAreaRatio: 0.004 };
  }
  return { minLuma: 245 - s * 70, percentile: 0.998, minContrast: 3.2 - s * 1.5, maxAreaRatio: 0.0015 };
}

export function luminance(data, width, height, out = new Uint8Array(width * height)) {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return out;
}

function percentileValue(luma, p) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  const target = luma.length * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

// Tampons réutilisés d'une image à l'autre pour éviter de solliciter le ramasse-miettes.
let scratch = null;
function buffers(n) {
  if (!scratch || scratch.n !== n) scratch = { n, labels: new Int32Array(n), stack: new Int32Array(n) };
  else scratch.labels.fill(0);
  return scratch;
}

export function detectGlints(data, width, height, opts = {}) {
  const mode = opts.mode || 'lens';
  const params = { ...sensitivityParams(opts.sensitivity, mode), ...opts };
  const luma = opts.luma || luminance(data, width, height);
  const n = width * height;
  const threshold = Math.max(params.minLuma, percentileValue(luma, params.percentile));
  const maxArea = Math.max(4, Math.round(n * params.maxAreaRatio));
  const minArea = params.minArea ?? 1;

  const { labels, stack } = buffers(n);
  const blobs = [];
  let next = 1;

  for (let start = 0; start < n; start++) {
    if (labels[start] || luma[start] < threshold) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let area = 0, sx = 0, sy = 0, peak = 0, sr = 0, sg = 0, sb = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let tooBig = false;
    while (top) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      area++;
      sx += x;
      sy += y;
      if (luma[p] > peak) peak = luma[p];
      const k = p * 4;
      sr += data[k];
      sg += data[k + 1];
      sb += data[k + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (area > maxArea) tooBig = true;
      // 4-connexité : on continue de marquer même un blob trop grand pour ne pas le revisiter.
      if (x > 0 && !labels[p - 1] && luma[p - 1] >= threshold) { labels[p - 1] = next; stack[top++] = p - 1; }
      if (x < width - 1 && !labels[p + 1] && luma[p + 1] >= threshold) { labels[p + 1] = next; stack[top++] = p + 1; }
      if (y > 0 && !labels[p - width] && luma[p - width] >= threshold) { labels[p - width] = next; stack[top++] = p - width; }
      if (y < height - 1 && !labels[p + width] && luma[p + width] >= threshold) { labels[p + width] = next; stack[top++] = p + width; }
    }
    next++;
    if (tooBig || area < minArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    const fill = area / (bw * bh);
    if (aspect < 0.4 || aspect > 2.5 || fill < 0.35) continue;
    blobs.push({ area, cx: sx / area, cy: sy / area, peak, minX, minY, maxX, maxY, bw, bh, fill, r: sr / area, g: sg / area, b: sb / area });
    if (blobs.length > 400) break;
  }

  const out = [];
  for (const bl of blobs) {
    // Contraste local : moyenne d'un anneau autour du blob.
    const pad = Math.max(3, Math.round(Math.max(bl.bw, bl.bh) * 1.5));
    const x0 = Math.max(0, bl.minX - pad), x1 = Math.min(width - 1, bl.maxX + pad);
    const y0 = Math.max(0, bl.minY - pad), y1 = Math.min(height - 1, bl.maxY + pad);
    let sum = 0, count = 0;
    for (let y = y0; y <= y1; y++) {
      const inRowBox = y >= bl.minY - 1 && y <= bl.maxY + 1;
      for (let x = x0; x <= x1; x++) {
        if (inRowBox && x >= bl.minX - 1 && x <= bl.maxX + 1) continue;
        sum += luma[y * width + x];
        count++;
      }
    }
    const ring = count ? sum / count : 0;
    const contrast = (bl.peak + 1) / (ring + 1);
    if (contrast < params.minContrast) continue;

    const sat = Math.max(bl.r, bl.g, bl.b) - Math.min(bl.r, bl.g, bl.b);
    // Teinte magenta/violette typique des LED infrarouges vues par un capteur.
    const irTint = bl.b > bl.g && bl.r > bl.g ? Math.min(1, (bl.r + bl.b - 2 * bl.g) / 120) : 0;
    const contrastScore = Math.min(1, (contrast - params.minContrast) / (params.minContrast * 1.5) + 0.35);
    const sizeScore = bl.area <= maxArea * 0.5 ? 1 : 0.6;
    let score = contrastScore * 0.6 + bl.fill * 0.25 + sizeScore * 0.15;
    if (mode === 'ir') score = Math.min(1, score * 0.8 + irTint * 0.3);
    out.push({
      x: bl.cx,
      y: bl.cy,
      radius: Math.max(bl.bw, bl.bh) / 2,
      area: bl.area,
      contrast,
      ring,
      peak: bl.peak,
      saturation: sat,
      irTint,
      score: Math.min(1, score),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.maxResults ?? 12);
}

// Suivi temporel : un vrai reflet persiste d'image en image.
export class GlintTracker {
  constructor({ maxDist = 0.05, minHits = 4, maxMisses = 6 } = {}) {
    this.maxDist = maxDist;
    this.minHits = minHits;
    this.maxMisses = maxMisses;
    this.tracks = [];
    this.nextId = 1;
  }

  update(detections, width) {
    const limit = this.maxDist * width;
    const used = new Set();
    for (const t of this.tracks) {
      let best = -1, bestD = limit;
      detections.forEach((d, i) => {
        if (used.has(i)) return;
        const dist = Math.hypot(d.x - t.x, d.y - t.y);
        if (dist < bestD) { bestD = dist; best = i; }
      });
      if (best >= 0) {
        const d = detections[best];
        used.add(best);
        t.x += (d.x - t.x) * 0.5;
        t.y += (d.y - t.y) * 0.5;
        t.radius += (d.radius - t.radius) * 0.4;
        t.score += (d.score - t.score) * 0.3;
        t.peak = d.peak;
        t.hits++;
        t.misses = 0;
      } else {
        t.misses++;
      }
    }
    detections.forEach((d, i) => {
      if (used.has(i)) return;
      this.tracks.push({ id: this.nextId++, x: d.x, y: d.y, radius: d.radius, score: d.score, peak: d.peak, hits: 1, misses: 0, verdict: null });
    });
    this.tracks = this.tracks.filter((t) => t.misses <= this.maxMisses);
    for (const t of this.tracks) {
      t.confirmed = t.hits >= this.minHits;
      t.confidence = Math.min(1, t.score * Math.min(1, t.hits / (this.minHits * 2))) * (t.misses ? 0.7 : 1);
    }
    return this.tracks;
  }

  confirmed() {
    return this.tracks.filter((t) => t.confirmed);
  }

  reset() {
    this.tracks = [];
  }
}

// Contrôle flash : un reflet disparaît quand on coupe la lampe, une LED non.
export function torchVerdict(lumaOn, lumaOff) {
  if (!Number.isFinite(lumaOn) || !Number.isFinite(lumaOff)) return null;
  return lumaOff < lumaOn * 0.6 ? 'reflet' : 'source';
}

// Luminance maximale dans un petit carré autour d'un point.
export function peakAround(luma, width, height, x, y, r = 3) {
  let peak = 0;
  const cx = Math.round(x), cy = Math.round(y);
  for (let yy = Math.max(0, cy - r); yy <= Math.min(height - 1, cy + r); yy++) {
    for (let xx = Math.max(0, cx - r); xx <= Math.min(width - 1, cx + r); xx++) {
      const v = luma[yy * width + xx];
      if (v > peak) peak = v;
    }
  }
  return peak;
}

// Regroupe les points voisins : l'anneau de LED d'une caméra infrarouge forme un seul appareil.
export function clusterTracks(tracks, maxGap) {
  const groups = [];
  for (const t of tracks) {
    const near = groups.filter((g) => g.some((m) => Math.hypot(m.x - t.x, m.y - t.y) <= maxGap));
    if (!near.length) {
      groups.push([t]);
      continue;
    }
    near[0].push(t);
    for (const other of near.slice(1)) {
      near[0].push(...other);
      groups.splice(groups.indexOf(other), 1);
    }
  }
  return groups.map((members) => {
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = members.reduce((s, m) => s + m.y, 0) / members.length;
    const radius = Math.max(...members.map((m) => Math.hypot(m.x - x, m.y - y) + m.radius));
    const verdicts = members.map((m) => m.verdict);
    return {
      id: members[0].id,
      members,
      count: members.length,
      x,
      y,
      radius,
      hits: Math.max(...members.map((m) => m.hits)),
      confidence: Math.max(...members.map((m) => m.confidence || 0)),
      confirmed: members.some((m) => m.confirmed),
      verdict: verdicts.includes('reflet') ? 'reflet' : verdicts.every((v) => v === 'source') ? 'source' : null,
    };
  });
}
