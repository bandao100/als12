import test from 'node:test';
import assert from 'node:assert/strict';
import { RssiFilter, estimateDistance, identifyDevice, rssiToLevel, shortUuid } from '../js/core/ble.js';

test('shortUuid extrait les UUID 16 bits', () => {
  assert.equal(shortUuid('0000feed-0000-1000-8000-00805f9b34fb'), 0xfeed);
  assert.equal(shortUuid('FD5A'), 0xfd5a);
  assert.equal(shortUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e'), null);
});

test('reconnaît un traceur du réseau Localiser d’Apple', () => {
  const r = identifyDevice({ manufacturerData: new Map([[0x004c, Uint8Array.from([0x12, 0x19, 0x10])]]) });
  assert.equal(r.kind, 'tracker');
  assert.equal(r.vendor, 'Apple');
  assert.equal(r.risk, 'high');
});

test('reconnaît SmartTag, Tile, Fast Pair et Google Find My', () => {
  assert.equal(identifyDevice({ uuids: ['0000fd5a-0000-1000-8000-00805f9b34fb'] }).label, 'Samsung SmartTag');
  assert.equal(identifyDevice({ uuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }).kind, 'tracker');
  assert.equal(identifyDevice({ serviceData: new Map([['0000fe2c-0000-1000-8000-00805f9b34fb', new Uint8Array([1])]]) }).kind, 'audio');
  assert.equal(identifyDevice({ serviceData: new Map([['0000feaa-0000-1000-8000-00805f9b34fb', new Uint8Array([0x41])]]) }).kind, 'tracker');
  assert.equal(identifyDevice({ serviceData: new Map([['0000feaa-0000-1000-8000-00805f9b34fb', new Uint8Array([0x10])]]) }).kind, 'beacon');
});

test('le nom trahit une caméra Wi-Fi', () => {
  const r = identifyDevice({ name: 'IPC-HD 360', manufacturerData: new Map([[0x0059, new Uint8Array([1])]]) });
  assert.equal(r.kind, 'camera');
  assert.equal(r.vendor, 'Nordic Semiconductor');
});

test('appareil inconnu', () => {
  const r = identifyDevice({});
  assert.equal(r.kind, 'other');
  assert.equal(r.label, 'Appareil inconnu');
});

test('distance estimée et filtre RSSI', () => {
  assert.ok(Math.abs(estimateDistance(-59) - 1) < 1e-9);
  assert.ok(Math.abs(estimateDistance(-41, 0) - 1) < 1e-9, 'puissance annoncée de 0 dBm');
  assert.ok(estimateDistance(-60, 4) > estimateDistance(-60, -12), 'un émetteur plus puissant paraît plus proche');
  assert.ok(estimateDistance(-80) > 5);
  const f = new RssiFilter();
  let v;
  for (const z of [-70, -60, -80, -70, -65, -75, -70]) v = f.update(z);
  assert.ok(v > -75 && v < -65);
  assert.equal(rssiToLevel(-100), 0);
  assert.equal(rssiToLevel(-20), 1);
});
