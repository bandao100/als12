// Surveillance routière : GPS, chargement des radars OpenStreetMap, alertes.
// Le service tourne en arrière-plan quel que soit l'onglet affiché.
import { chime, speak, vibrate } from '../core/audio.js';
import { distance, spokenDistance } from '../core/geo.js';
import {
  AlertTracker,
  CATEGORIES,
  OVERPASS_ENDPOINTS,
  alertDistanceFor,
  buildOverpassQuery,
  computeThreats,
  motionFrom,
  parseOverpass,
  pickAlert,
} from '../core/radar-logic.js';
import { Compass } from '../core/sensors.js';
import { readJSON, settings, writeJSON } from '../core/store.js';
import { createWakeLock } from '../core/ui.js';
import { createDemoDrive } from '../sim/demo.js';

const CACHE_KEY = 'sentinelle:osm-cache:v1';
const REPORT_KEY = 'sentinelle:reported:v1';
const FETCH_RADIUS = 8000;
const REFETCH_AFTER = 3000;
const REPORT_TTL = 7 * 24 * 3600 * 1000;

export class RadarService extends EventTarget {
  constructor() {
    super();
    this.state = {
      running: false,
      status: 'idle',
      pos: null,
      accuracy: null,
      speedKmh: null,
      heading: null,
      headingSource: null,
      osm: [],
      threats: [],
      alert: null,
      alertDistance: alertDistanceFor(0),
      overspeed: false,
      fetch: { at: null, center: null, count: 0, origin: null, loading: false, error: null },
      error: null,
      demo: false,
    };
    this.reported = this.loadReported();
    this.tracker = new AlertTracker();
    this.compass = new Compass((h) => this.onCompass(h));
    this.wake = createWakeLock();
    this.lastFix = null;
    this.lastFetchFail = 0;
    this.lastOverBeep = 0;
    settings.subscribe((key) => {
      if (key === 'categories' || key === 'lookAhead' || key === 'dangerZones') this.recompute();
      if (key === 'categories' && this.state.running && this.state.pos && !this.state.demo) this.maybeFetch(this.state.pos, true);
    });
  }

  emit() {
    this.dispatchEvent(new Event('update'));
  }

  get points() {
    return [...this.state.osm, ...this.reported];
  }

  async start() {
    if (this.state.running) return;
    const demo = settings.get('demo');
    Object.assign(this.state, { running: true, status: 'locating', error: null, demo });
    this.tracker = new AlertTracker();
    this.lastFix = null;
    this.wake.on();
    this.emit();
    if (demo) {
      this.drive = createDemoDrive();
      this.state.osm = this.drive.points;
      this.state.fetch = { at: Date.now(), center: null, count: this.drive.points.length, origin: 'démo', loading: false, error: null };
      this.timer = setInterval(() => this.onFix(this.drive.tick(Date.now())), 1000);
      this.onFix(this.drive.tick(Date.now()));
      return;
    }
    if (!('geolocation' in navigator)) {
      this.fail('Ce navigateur ne donne pas accès au GPS.');
      return;
    }
    this.compass.start();
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        this.onFix({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          speed: p.coords.speed,
          heading: p.coords.heading,
          t: p.timestamp || Date.now(),
        }),
      (err) => this.onGeoError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    clearInterval(this.timer);
    this.compass.stop();
    this.wake.off();
    Object.assign(this.state, { running: false, status: 'idle', alert: null, overspeed: false });
    // Le trajet simulé ne doit pas survivre à la démo.
    if (this.state.demo) Object.assign(this.state, { osm: [], pos: null, threats: [], speedKmh: null, heading: null, headingSource: null, accuracy: null });
    this.emit();
  }

  fail(message) {
    Object.assign(this.state, { status: 'error', error: message });
    this.emit();
  }

  onGeoError(err) {
    const messages = {
      1: "L'accès à la position a été refusé. Autorisez la localisation pour ce site dans les réglages du navigateur.",
      2: 'Position introuvable. Vérifiez que le GPS est activé et que le ciel est dégagé.',
      3: 'Le GPS met trop de temps à répondre. Nouvelle tentative en cours…',
    };
    if (err.code === 3 && this.state.pos) return;
    this.fail(messages[err.code] || 'Erreur de localisation.');
  }

  onCompass(h) {
    if (this.state.headingSource === 'gps') return;
    this.state.heading = h;
    this.state.headingSource = 'boussole';
    if (this.state.pos) this.recompute();
  }

  onFix(fix) {
    const motion = motionFrom(this.lastFix, fix);
    if (!this.lastFix || distance(this.lastFix, fix) > 8) this.lastFix = fix;
    // Vitesse du GPS si fournie, sinon déduite du déplacement quand la précision le permet.
    const speed = Number.isFinite(fix.speed) ? fix.speed : fix.accuracy <= 60 ? motion?.speed ?? null : null;
    const moving = speed != null && speed > 2;
    let heading = null;
    let source = null;
    if (moving && Number.isFinite(fix.heading)) {
      heading = fix.heading;
      source = 'gps';
    } else if (moving && motion?.heading != null) {
      heading = motion.heading;
      source = 'gps';
    } else if (this.compass.heading != null) {
      heading = this.compass.heading;
      source = 'boussole';
    } else if (this.state.headingSource === 'gps') {
      heading = this.state.heading;
      source = 'gps';
    }
    Object.assign(this.state, {
      status: 'tracking',
      error: null,
      pos: { lat: fix.lat, lon: fix.lon },
      accuracy: fix.accuracy,
      speedKmh: speed != null ? speed * 3.6 : null,
      heading,
      headingSource: source,
    });
    if (!this.state.demo) this.maybeFetch(this.state.pos);
    this.recompute();
  }

  recompute() {
    const s = this.state;
    if (!s.pos) return this.emit();
    this.pruneReported();
    s.alertDistance = alertDistanceFor(s.speedKmh, { lookAhead: settings.get('lookAhead') });
    if (settings.get('dangerZones')) s.alertDistance = Math.max(s.alertDistance, 2000);
    s.threats = computeThreats(this.points, s.pos, { heading: s.heading, enabled: settings.get('categories') });
    s.alert = s.running ? pickAlert(s.threats, s.alertDistance) : null;
    const limit = s.alert?.point.maxspeed;
    s.overspeed = !!(limit && s.speedKmh != null && s.speedKmh > limit + 3);
    if (s.running) this.announce(this.tracker.update(s.alert, s.alertDistance));
    if (s.overspeed && Date.now() - this.lastOverBeep > 2500) {
      this.lastOverBeep = Date.now();
      chime('over');
    }
    this.emit();
  }

  announce(events) {
    const danger = settings.get('dangerZones');
    for (const e of events) {
      if (e.type === 'exit') {
        chime('exit');
        continue;
      }
      const a = this.state.alert;
      if (!a) continue;
      const label = danger ? 'Zone de danger' : CATEGORIES[a.point.category].label;
      if (e.type === 'enter') {
        chime(e.level);
        vibrate([180, 80, 180]);
        const limit = !danger && a.point.maxspeed ? `, limité à ${a.point.maxspeed}` : '';
        setTimeout(() => speak(`${label} dans ${spokenDistance(a.distance)}${limit}`), 450);
      } else if (e.type === 'escalate') {
        chime(e.level);
        vibrate(e.level === 'imminent' ? [90, 50, 90, 50, 90] : [140]);
        if (e.level === 'imminent') setTimeout(() => speak(danger ? 'Fin de zone proche, restez vigilant' : `${label} tout proche`), 600);
      }
    }
  }

  // ───── Données OpenStreetMap ─────

  async maybeFetch(pos, force = false) {
    const f = this.state.fetch;
    if (f.loading) return;
    const far = !f.center || distance(f.center, pos) > REFETCH_AFTER;
    if (!far && !force) return;
    if (!force && Date.now() - this.lastFetchFail < 30000) return;
    const surveillance = settings.get('categories').surveillance;
    const cached = this.findCache(pos, surveillance);
    if (cached && !force) {
      this.state.osm = cached.points;
      this.state.fetch = { at: cached.at, center: cached.center, count: cached.points.length, origin: 'cache', loading: false, error: null };
      if (Date.now() - cached.at < 3 * 24 * 3600 * 1000) return this.recompute();
    }
    this.state.fetch = { ...this.state.fetch, loading: true, error: null };
    this.emit();
    try {
      const query = buildOverpassQuery(pos, FETCH_RADIUS, { surveillanceRadius: surveillance ? 2000 : 0 });
      const json = await this.overpass(query);
      const points = parseOverpass(json);
      const entry = { center: pos, at: Date.now(), points, surveillance };
      this.saveCache(entry);
      this.state.osm = points;
      this.state.fetch = { at: entry.at, center: pos, count: points.length, origin: 'réseau', loading: false, error: null };
    } catch {
      this.lastFetchFail = Date.now();
      const fallback = this.findCache(pos, surveillance, true);
      if (fallback) this.state.osm = fallback.points;
      this.state.fetch = {
        ...this.state.fetch,
        loading: false,
        origin: fallback ? 'cache' : this.state.fetch.origin,
        error: navigator.onLine === false ? 'Hors ligne : radars en mémoire uniquement.' : 'Serveur OpenStreetMap injoignable, nouvel essai dans 30 s.',
      };
    }
    this.recompute();
  }

  async overpass(query) {
    let lastError = null;
    for (const url of OVERPASS_ENDPOINTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastError = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Overpass indisponible');
  }

  findCache(pos, surveillance, anyAge = false) {
    const entries = readJSON(CACHE_KEY, []);
    return (
      entries.find(
        (e) =>
          distance(e.center, pos) < FETCH_RADIUS - REFETCH_AFTER &&
          (!surveillance || e.surveillance) &&
          (anyAge || Date.now() - e.at < 3 * 24 * 3600 * 1000),
      ) || null
    );
  }

  saveCache(entry) {
    const entries = readJSON(CACHE_KEY, []).filter((e) => distance(e.center, entry.center) > 1000);
    entries.unshift(entry);
    // Le stockage local est limité : on réduit jusqu'à ce que l'écriture passe.
    for (let n = Math.min(entries.length, 8); n > 0; n--) if (writeJSON(CACHE_KEY, entries.slice(0, n))) break;
  }

  clearCache() {
    writeJSON(CACHE_KEY, []);
    this.state.fetch = { at: null, center: null, count: 0, origin: null, loading: false, error: null };
    if (!this.state.demo) this.state.osm = [];
    this.recompute();
  }

  // ───── Signalements de l'utilisateur ─────

  loadReported() {
    return readJSON(REPORT_KEY, []).filter((p) => Date.now() - p.at < REPORT_TTL);
  }

  pruneReported() {
    const before = this.reported.length;
    this.reported = this.reported.filter((p) => Date.now() - p.at < REPORT_TTL);
    if (this.reported.length !== before) writeJSON(REPORT_KEY, this.reported);
  }

  report() {
    const pos = this.state.pos;
    if (!pos) return null;
    const point = { id: `me:${Date.now()}`, lat: pos.lat, lon: pos.lon, category: 'reported', maxspeed: null, at: Date.now(), source: 'moi' };
    this.reported.push(point);
    writeJSON(REPORT_KEY, this.reported);
    this.recompute();
    return point;
  }

  removeReported(id) {
    this.reported = this.reported.filter((p) => p.id !== id);
    writeJSON(REPORT_KEY, this.reported);
    this.recompute();
  }
}

export const radarService = new RadarService();
