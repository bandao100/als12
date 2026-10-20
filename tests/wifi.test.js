import test from 'node:test';
import assert from 'node:assert/strict';
import { band, channel, identifyNetwork, isRandomMac, rankNetworks, security, signalLabel } from '../js/core/wifi.js';

test('repère le point d’accès d’une caméra par son nom', () => {
  for (const ssid of ['IPC-365', 'HD-8821A3', 'Tapo_C200_3B10', 'V380-445566', 'CAM_salon', 'HDWiFiCam-P2P']) {
    assert.equal(identifyNetwork({ ssid, bssid: '02:00:00:00:00:00' }).kind, 'camera', ssid);
  }
  for (const ssid of ['Livebox-4F2A', 'Camping des Pins', 'Freebox-123456', 'Bbox-ABC']) {
    assert.notEqual(identifyNetwork({ ssid, bssid: '00:11:22:33:44:55' }).kind, 'camera', ssid);
  }
});

test('identifie le fabricant par le préfixe matériel', () => {
  const hik = identifyNetwork({ ssid: 'Salle-3', bssid: '44:19:B6:12:34:56' });
  assert.equal(hik.kind, 'camera');
  assert.equal(hik.vendor, 'Hikvision');
  const esp = identifyNetwork({ ssid: 'Maison', bssid: '24-0A-C4-00-11-22' });
  assert.equal(esp.kind, 'iot');
  assert.equal(esp.risk, 'medium');
});

test('adresse aléatoire et réseau masqué', () => {
  assert.equal(isRandomMac('da:a1:19:00:00:01'), true);
  assert.equal(isRandomMac('44:19:b6:00:00:01'), false);
  const hidden = identifyNetwork({ ssid: '', bssid: '00:11:22:33:44:55' });
  assert.equal(hidden.kind, 'hidden');
  // Une adresse aléatoire masque le fabricant même si les octets suivants coïncident.
  assert.equal(identifyNetwork({ ssid: 'Salle', bssid: '46:19:b6:00:00:01' }).vendor, null);
});

test('bande, canal, sécurité et signal', () => {
  assert.equal(band(2437), '2,4 GHz');
  assert.equal(channel(2437), 6);
  assert.equal(band(5180), '5 GHz');
  assert.equal(channel(5180), 36);
  assert.equal(band(6115), '6 GHz');
  assert.equal(channel(6115), 33);
  assert.equal(security('[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]'), 'WPA2');
  assert.equal(security('[RSN-SAE-CCMP][ESS]'), 'WPA3');
  assert.equal(security('[ESS]'), 'Ouvert');
  assert.equal(signalLabel(-45), 'Très proche');
  assert.equal(signalLabel(-90), 'Lointain');
});

test('le classement met les caméras en tête', () => {
  const ranked = rankNetworks([
    { ssid: 'Livebox', bssid: '00:11:22:33:44:55', level: -40 },
    { ssid: 'IPC-1', bssid: '00:11:22:33:44:56', level: -80 },
    { ssid: '', bssid: '00:11:22:33:44:57', level: -60 },
  ]);
  assert.deepEqual(ranked.map((n) => n.info.kind), ['camera', 'hidden', 'router']);
});
