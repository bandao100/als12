import test from 'node:test';
import assert from 'node:assert/strict';
import { ToneTracker, bandLevel, findTonalPeaks, formatFrequency, frequencyBin } from '../js/core/spectrum.js';

const SR = 48000, FFT = 4096;
function spectrum(tones = []) {
  const db = new Float32Array(FFT / 2);
  for (let i = 0; i < db.length; i++) db[i] = -95 + Math.sin(i * 1.7) * 3;
  for (const f of tones) {
    const b = frequencyBin(f, SR, FFT);
    db[b - 1] = -60; db[b] = -45; db[b + 1] = -60;
  }
  return db;
}

test('trouve une tonalité à 19,5 kHz', () => {
  const { peaks, floor } = findTonalPeaks(spectrum([19500]), SR, FFT);
  assert.equal(peaks.length, 1);
  assert.ok(Math.abs(peaks[0].freq - 19500) < 20);
  assert.ok(floor < -90);
});

test('ignore le bruit de fond et les tonalités audibles', () => {
  assert.equal(findTonalPeaks(spectrum([]), SR, FFT).peaks.length, 0);
  assert.equal(findTonalPeaks(spectrum([8000]), SR, FFT).peaks.length, 0);
});

test('le suivi exige une tonalité persistante', () => {
  const tr = new ToneTracker({ minFrames: 3 });
  const { peaks } = findTonalPeaks(spectrum([20000]), SR, FFT);
  assert.equal(tr.update(peaks).length, 0);
  tr.update(peaks);
  assert.equal(tr.update(peaks).length, 1);
});

test('niveau de bande et format', () => {
  assert.ok(bandLevel(spectrum([]), SR, FFT, 17000, 22000) < -85);
  assert.equal(formatFrequency(19480), '19,5 kHz');
});
