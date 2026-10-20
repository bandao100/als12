import test from 'node:test';
import assert from 'node:assert/strict';
import { fromNativeAdvert, hexToBytes, isNative } from '../js/core/native.js';
import { identifyDevice } from '../js/core/ble.js';

test('hors application Android, le pont est absent', () => {
  assert.equal(isNative, false);
});

test('les annonces natives sont converties pour l’identification', () => {
  assert.deepEqual([...hexToBytes('12190a')], [0x12, 0x19, 0x0a]);
  const adv = fromNativeAdvert({ id: 'AA:BB', rssi: -60, txPower: 4, manufacturer: { 76: '1219' }, serviceData: {}, uuids: [] });
  assert.equal(adv.txPower, 4);
  assert.equal(identifyDevice(adv).kind, 'tracker');
  const tag = fromNativeAdvert({ id: 'CC', rssi: -70, serviceData: { '0000fd5a-0000-1000-8000-00805f9b34fb': '01' } });
  assert.equal(identifyDevice(tag).label, 'Samsung SmartTag');
});
