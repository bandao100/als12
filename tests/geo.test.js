import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, bearing, destination, distance, formatDistance, normalizeAngle, spokenDistance, toLocalXY } from '../js/core/geo.js';

const paris = { lat: 48.8566, lon: 2.3522 };
const lyon = { lat: 45.764, lon: 4.8357 };

test('distance Paris–Lyon ≈ 392 km', () => {
  const d = distance(paris, lyon);
  assert.ok(Math.abs(d - 392000) < 3000, `obtenu ${d}`);
});

test('bearing vers le nord et vers l’est', () => {
  assert.ok(Math.abs(bearing(paris, { lat: 49, lon: 2.3522 })) < 0.01);
  const east = bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(east - 90) < 0.01);
});

test('angleDiff renvoie l’écart signé le plus court', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(90, 270), -180);
  assert.equal(normalizeAngle(-90), 270);
});

test('destination puis toLocalXY sont cohérents', () => {
  const p = destination(paris, 45, 1000);
  const { x, y } = toLocalXY(paris, p);
  assert.ok(Math.abs(Math.hypot(x, y) - 1000) < 2);
  assert.ok(Math.abs(x - y) < 2);
  assert.ok(Math.abs(distance(paris, p) - 1000) < 2);
});

test('formatDistance à la française', () => {
  assert.equal(formatDistance(42), '40 m');
  assert.equal(formatDistance(456), '460 m');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(15400), '15 km');
  assert.equal(spokenDistance(480), '500 mètres');
  assert.equal(spokenDistance(2300), '2,3 kilomètres');
});
