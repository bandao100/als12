import test from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../js/core/geo.js';
import { AlertTracker, alertDistanceFor, buildOverpassQuery, computeThreats, motionFrom, parseMaxspeed, parseOverpass, pickAlert } from '../js/core/radar-logic.js';

const sample = {
  elements: [
    { type: 'node', id: 1, lat: 48.85, lon: 2.35, tags: { highway: 'speed_camera', maxspeed: '50' } },
    { type: 'node', id: 2, lat: 48.86, lon: 2.36, tags: { man_made: 'surveillance', 'surveillance:type': 'camera' } },
    { type: 'node', id: 3, lat: 48.87, lon: 2.37, tags: { man_made: 'surveillance', 'surveillance:type': 'guard' } },
    { type: 'relation', id: 10, tags: { type: 'enforcement', enforcement: 'traffic_signals' }, members: [{ type: 'node', ref: 4, role: 'device' }, { type: 'node', ref: 5, role: 'from' }] },
    { type: 'relation', id: 11, tags: { type: 'enforcement', enforcement: 'maxspeed', maxspeed: '30 mph' }, members: [{ type: 'node', ref: 1, role: 'device' }] },
    { type: 'relation', id: 12, tags: { type: 'enforcement', enforcement: 'toll' }, members: [{ type: 'node', ref: 6, role: 'device' }] },
    { type: 'node', id: 4, lat: 48.851, lon: 2.351 },
    { type: 'node', id: 5, lat: 48.852, lon: 2.352 },
    { type: 'node', id: 6, lat: 48.853, lon: 2.353 },
    { type: 'node', id: 1, lat: 48.85, lon: 2.35 },
  ],
};

test('parseOverpass normalise radars, feux rouges et caméras', () => {
  const pts = parseOverpass(sample);
  const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
  assert.equal(pts.length, 3);
  assert.equal(byId['osm:n1'].category, 'fixed');
  assert.equal(byId['osm:n1'].maxspeed, 48, 'la limite de la relation (30 mph) prime');
  assert.equal(byId['osm:n2'].category, 'surveillance');
  assert.equal(byId['osm:n4'].category, 'redlight');
  assert.equal(byId['osm:n3'], undefined, 'un gardien n’est pas une caméra');
  assert.equal(byId['osm:n6'], undefined, 'les péages sont ignorés');
});

test('parseOverpass tolère une réponse vide ou invalide', () => {
  assert.deepEqual(parseOverpass(null), []);
  assert.deepEqual(parseOverpass({}), []);
});

test('buildOverpassQuery inclut la vidéosurveillance seulement sur demande', () => {
  const q1 = buildOverpassQuery({ lat: 1, lon: 2 }, 5000);
  assert.match(q1, /speed_camera/);
  assert.doesNotMatch(q1, /surveillance/);
  const q2 = buildOverpassQuery({ lat: 1, lon: 2 }, 5000, { surveillanceRadius: 1500 });
  assert.match(q2, /around:1500,1\.000000,2\.000000/);
});

test('parseMaxspeed', () => {
  assert.equal(parseMaxspeed('90'), 90);
  assert.equal(parseMaxspeed('50 mph'), 80);
  assert.equal(parseMaxspeed('FR:urban'), 50);
  assert.equal(parseMaxspeed('none'), null);
  assert.equal(parseMaxspeed(undefined), null);
});

test('alertDistanceFor borne la distance d’anticipation', () => {
  assert.equal(alertDistanceFor(0), 400);
  assert.equal(alertDistanceFor(90), 750);
  assert.equal(alertDistanceFor(300), 2000);
});

const here = { lat: 48.85, lon: 2.35 };
const ahead = { id: 'a', category: 'fixed', ...destination(here, 0, 600) };
const behind = { id: 'b', category: 'fixed', ...destination(here, 180, 300) };
const cam = { id: 'c', category: 'surveillance', ...destination(here, 0, 200) };

test('seuls les radars devant soi déclenchent une alerte', () => {
  const threats = computeThreats([ahead, behind, cam], here, { heading: 0 });
  assert.equal(threats[0].point.id, 'c');
  assert.equal(threats.find((t) => t.point.id === 'b').ahead, false);
  const alert = pickAlert(threats, 750);
  assert.equal(alert.point.id, 'a', 'la vidéosurveillance n’est pas une alerte routière');
  assert.equal(pickAlert(computeThreats([ahead], here, { heading: 180 }), 750), null);
});

test('les catégories désactivées sont filtrées', () => {
  const threats = computeThreats([ahead, cam], here, { heading: 0, enabled: { fixed: false, surveillance: true } });
  assert.deepEqual(threats.map((t) => t.point.id), ['c']);
});

test('AlertTracker annonce une seule fois puis escalade', () => {
  const tr = new AlertTracker();
  const mk = (d) => ({ point: { id: 'a' }, distance: d });
  assert.deepEqual(tr.update(mk(700), 750, 0).map((e) => e.type), ['enter']);
  assert.deepEqual(tr.update(mk(650), 750, 1), []);
  assert.deepEqual(tr.update(mk(400), 750, 2).map((e) => e.level), ['near']);
  assert.deepEqual(tr.update(mk(150), 750, 3).map((e) => e.level), ['imminent']);
  assert.deepEqual(tr.update(null, 750, 4).map((e) => e.type), ['exit']);
  assert.deepEqual(tr.update(mk(100), 750, 5), [], 'pas de nouvelle annonce juste après le passage');
});

test('motionFrom calcule vitesse et cap', () => {
  const a = { ...here, t: 0 };
  const b = { ...destination(here, 90, 100), t: 5000 };
  const m = motionFrom(a, b);
  assert.ok(Math.abs(m.speed - 20) < 0.1);
  assert.ok(Math.abs(m.heading - 90) < 0.5);
  assert.equal(motionFrom(a, { ...here, t: 1000 }).heading, null);
});
