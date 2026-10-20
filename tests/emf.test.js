import test from 'node:test';
import assert from 'node:assert/strict';
import { EmfMeter, emfLevel, gaugeRatio, magnitude } from '../js/core/emf.js';

test('magnitude et niveaux', () => {
  assert.equal(magnitude(3, 4, 12), 13);
  assert.equal(emfLevel(2).key, 'calm');
  assert.equal(emfLevel(-30).key, 'moderate');
  assert.equal(emfLevel(500).key, 'intense');
});

test('calibration puis détection d’un écart', () => {
  const m = new EmfMeter({ alpha: 1 });
  m.calibrate();
  for (let i = 0; i < 30; i++) m.update(30, 20, 30 + (i % 3));
  assert.ok(Math.abs(m.baseline - magnitude(30, 20, 31)) < 0.5);
  const r = m.update(30, 20, 120);
  assert.ok(r.delta > 60);
  assert.equal(r.level.key, 'high');
});

test('pas de fausse alerte pendant le calibrage', () => {
  const m = new EmfMeter();
  m.calibrate();
  const r = m.update(30, 20, 30);
  assert.equal(r.delta, 0);
  assert.equal(r.level.key, 'calm');
});

test('jauge logarithmique bornée', () => {
  assert.equal(gaugeRatio(0), 0);
  assert.equal(gaugeRatio(1000), 1);
  assert.ok(gaugeRatio(10) > 0.3 && gaugeRatio(10) < 0.5);
});
