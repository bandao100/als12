/* Ticket Secure Scanner — contrôle des billets avec ou sans connexion.
 *
 * - En ligne : chaque QR est validé par le serveur (verrou en base, usage unique garanti).
 * - Hors connexion : validation contre le manifeste local (empreintes des billets),
 *   le billet est marqué utilisé sur l'appareil et le contrôle est mis en file.
 * - Au retour du réseau : la file est envoyée (idempotente), puis les statuts des
 *   billets utilisés sur les autres appareils sont récupérés.
 *
 * Le même code tourne dans Chrome (PWA) et dans l'application Android (WebView).
 */
(function () {
  'use strict';

  var CFG_KEY = 'tsp.scanner.config.v1';
  var SYNC_EVERY_MS = 20000;
  var ONLINE_TIMEOUT_MS = 3500;
  var MESSAGES = {
    accepted: 'ENTRÉE AUTORISÉE',
    duplicate: 'DÉJÀ UTILISÉ — ACCÈS REFUSÉ',
    invalid: 'BILLET INCONNU — ACCÈS REFUSÉ',
    cancelled: 'BILLET ANNULÉ — ACCÈS REFUSÉ',
    wrong_event: 'MAUVAIS ÉVÉNEMENT OU MAUVAISE PORTE',
    event_closed: 'ÉVÉNEMENT ANNULÉ — ACCÈS REFUSÉ',
    conflict: 'CONFLIT : DÉJÀ UTILISÉ AILLEURS',
    error: 'ERREUR'
  };

  var $ = function (id) { return document.getElementById(id); };
  var cfg = loadConfig();
  var db = null;
  var busy = false, syncing = false, online = false, history = [];
  var camera = null;

  // ---------------------------------------------------------------- configuration
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConfig() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  function defaultServer() {
    var param = new URLSearchParams(location.search).get('server');
    if (param) return param.replace(/\/+$/, '');
    if (location.protocol.indexOf('http') === 0 && location.pathname.indexOf('/static/scanner/') !== -1) {
      return location.origin;
    }
    return '';
  }

  // ---------------------------------------------------------------- IndexedDB
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('tsp-scanner', 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        var t = d.createObjectStore('tickets', { keyPath: 'k' });
        t.createIndex('event', 'e');
        d.createObjectStore('queue', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode), s = t.objectStore(store), out;
      var r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = function () { out = r.result; };
      t.oncomplete = function () { resolve(out); };
      t.onerror = t.onabort = function () { reject(t.error); };
    });
  }
  var idb = {
    get: function (store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); },
    put: function (store, value) { return tx(store, 'readwrite', function (s) { return s.put(value); }); },
    del: function (store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); },
    all: function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); },
    count: function (store) { return tx(store, 'readonly', function (s) { return s.count(); }); },
    countEvent: function (eventId) {
      return tx('tickets', 'readonly', function (s) { return s.index('event').count(IDBKeyRange.only(eventId)); });
    },
    putMany: function (store, values) {
      return tx(store, 'readwrite', function (s) { values.forEach(function (v) { s.put(v); }); });
    },
    clearEvent: function (eventId) {
      return tx('tickets', 'readwrite', function (s) {
        var req = s.index('event').openKeyCursor(IDBKeyRange.only(eventId));
        req.onsuccess = function () { var c = req.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
      });
    },
    clearAll: function () {
      return Promise.all(['tickets', 'queue', 'meta'].map(function (n) {
        return tx(n, 'readwrite', function (s) { return s.clear(); });
      }));
    }
  };

  // ---------------------------------------------------------------- utilitaires
  async function sha256hex(text) {
    if (!(window.crypto && crypto.subtle)) throw new Error('Contexte non sécurisé : HTTPS requis.');
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var a = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function fmtTime(iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('fr-FR') : '—'; }

  function ApiError(message, status) { this.message = message; this.status = status; }
  function NetworkError(message) { this.message = message; }

  async function api(path, options, timeoutMs) {
    options = options || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000);
    var resp;
    try {
      resp = await fetch(cfg.server + '/api/v1' + path, {
        method: options.method || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: ctrl.signal, credentials: 'omit', cache: 'no-store'
      });
    } catch (e) {
      throw new NetworkError('Réseau indisponible');
    } finally { clearTimeout(timer); }
    var data = {};
    try { data = await resp.json(); } catch (e) { /* corps vide */ }
    if (resp.status === 401 && cfg.token && path !== '/appareils') {
      await forgetDevice('Cet appareil a été révoqué ou sa session a expiré. Reconnectez-le.');
      throw new ApiError(data.message || 'Appareil révoqué', 401);
    }
    if (!resp.ok) throw new ApiError(data.message || ('Erreur ' + resp.status), resp.status);
    return data;
  }

  function setOnline(value) {
    online = value;
    var el = $('net');
    el.textContent = value ? 'En ligne' : 'Hors ligne';
    el.className = 'net ' + (value ? 'on' : 'off');
  }

  // ---------------------------------------------------------------- écrans
  function showSetup(message) {
    $('main').hidden = true;
    $('setup').hidden = false;
    $('server').value = cfg.server || defaultServer();
    $('setupError').textContent = message || '';
    if (camera) camera.stop();
  }

  async function showMain() {
    $('setup').hidden = true;
    $('main').hidden = false;
    $('who').textContent = (cfg.user ? cfg.user.name + ' · ' + cfg.user.role : '') + (cfg.org ? ' · ' + cfg.org : '');
    $('mode').value = cfg.mode || 'auto';
    renderEvents();
    await refreshStatus();
    loadEvents();
    sync();
  }

  function renderEvents() {
    var sel = $('eventSel');
    sel.innerHTML = '';
    (cfg.events || []).forEach(function (e) {
      var o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.name + ' · ' + new Date(e.starts_at).toLocaleDateString('fr-FR') +
        (e.category_restriction ? ' · ' + e.category_restriction : '') + (e.offline_allowed ? '' : ' · en ligne uniquement');
      sel.appendChild(o);
    });
    if (!cfg.events || !cfg.events.length) {
      var o = document.createElement('option');
      o.textContent = 'Aucun événement affecté';
      o.value = '';
      sel.appendChild(o);
    }
    if (cfg.eventId) sel.value = String(cfg.eventId);
    if (!sel.value && cfg.events && cfg.events.length) { cfg.eventId = cfg.events[0].id; sel.value = String(cfg.eventId); saveConfig(); }
  }

  async function loadEvents() {
    try {
      var data = await api('/evenements', {}, 8000);
      cfg.events = data.events;
      saveConfig();
      setOnline(true);
      renderEvents();
      refreshStatus();
    } catch (e) { if (e instanceof NetworkError) setOnline(false); }
  }

  function currentEvent() {
    var id = parseInt($('eventSel').value, 10);
    return (cfg.events || []).filter(function (e) { return e.id === id; })[0] || null;
  }

  async function refreshStatus() {
    var ev = currentEvent();
    var queued = await idb.count('queue');
    $('queueInfo').textContent = queued ? queued + ' contrôle(s) à synchroniser' : 'Tout est synchronisé';
    if (!ev) { $('manifestInfo').textContent = ''; return; }
    var meta = await idb.get('meta', 'manifest:' + ev.id);
    if (!ev.offline_allowed) {
      $('manifestInfo').textContent = 'Mode hors connexion désactivé par l\'organisateur pour cet événement.';
    } else if (meta) {
      $('manifestInfo').textContent = 'Prêt hors connexion : ' + meta.count + ' billet(s) · mis à jour ' + fmtDate(meta.at);
    } else {
      $('manifestInfo').textContent = 'Pas encore préparé : appuyez sur « Préparer hors connexion » tant que le réseau est disponible.';
    }
  }

  // ---------------------------------------------------------------- manifeste
  async function pendingKeys() {
    var q = await idb.all('queue');
    var keys = {};
    q.forEach(function (s) { if (s.local_result === 'accepted') keys[s.key] = true; });
    return keys;
  }

  async function pullManifest(eventId, delta) {
    var meta = await idb.get('meta', 'manifest:' + eventId);
    var path = '/evenements/' + eventId + '/manifeste';
    if (delta && meta && meta.server_time) path += '?depuis=' + encodeURIComponent(meta.server_time);
    var data = await api(path, {}, 60000);
    if (data.full) await idb.clearEvent(eventId);
    var pending = await pendingKeys();
    var rows = [];
    for (var i = 0; i < data.tickets.length; i++) {
      var t = data.tickets[i];
      var status = t[2];
      // Un billet admis ici mais pas encore synchronisé reste « utilisé » localement.
      if (pending[t[0]] && status === 'valid') status = 'used';
      rows.push({ k: eventId + ':' + t[0], e: eventId, n: t[1], s: status, c: t[3] });
    }
    for (var j = 0; j < rows.length; j += 2000) await idb.putMany('tickets', rows.slice(j, j + 2000));
    var count = await idb.countEvent(eventId);
    await idb.put('meta', { k: 'manifest:' + eventId, server_time: data.server_time, count: count, at: new Date().toISOString() });
    return count;
  }

  async function prepare() {
    var ev = currentEvent();
    if (!ev) return;
    var btn = $('prepare');
    btn.disabled = true;
    btn.textContent = 'Téléchargement…';
    try {
      await syncQueue();
      var count = await pullManifest(ev.id, false);
      setOnline(true);
      show('accepted', 'PRÊT HORS CONNEXION', count + ' billet(s) chargé(s) sur cet appareil');
    } catch (e) {
      show('error', 'PRÉPARATION IMPOSSIBLE', e.message || 'Réseau indisponible');
      if (e instanceof NetworkError) setOnline(false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Préparer hors connexion';
      refreshStatus();
    }
  }

  // ---------------------------------------------------------------- contrôle
  function show(status, title, detail, source) {
    var box = $('result');
    box.className = 'result ' + status;
    box.innerHTML = '';
    var b = document.createElement('b'); b.textContent = title; box.appendChild(b);
    var s = document.createElement('span'); s.textContent = detail || ''; box.appendChild(s);
    if (source) { var src = document.createElement('span'); src.className = 'src'; src.textContent = source; box.appendChild(src); }
  }

  function addHistory(res) {
    history.unshift({ at: new Date().toISOString(), status: res.status, no: res.ticket || '—', src: res.source });
    history = history.slice(0, 30);
    var ol = $('history');
    ol.innerHTML = '';
    history.forEach(function (h) {
      var li = document.createElement('li');
      var left = document.createElement('span');
      left.textContent = fmtTime(h.at) + ' · ' + h.no;
      var right = document.createElement('span');
      right.className = h.status === 'accepted' ? 'ok' : 'ko';
      right.textContent = (MESSAGES[h.status] || h.status).split(' —')[0] + (h.src === 'offline' ? ' · hors ligne' : '');
      li.appendChild(left); li.appendChild(right);
      ol.appendChild(li);
    });
  }

  async function validateOffline(token, key, ev) {
    var meta = await idb.get('meta', 'manifest:' + ev.id);
    if (!meta) {
      return { status: 'error', message: 'ÉVÉNEMENT NON PRÉPARÉ', detail: 'Réseau indisponible et billets non chargés sur l\'appareil.' };
    }
    var t = await idb.get('tickets', ev.id + ':' + key);
    var status;
    if (!t) status = 'invalid';
    else if (t.s === 'used') status = 'duplicate';
    else if (t.s === 'cancelled') status = 'cancelled';
    else {
      status = 'accepted';
      t.s = 'used';
      await idb.put('tickets', t);
    }
    await idb.put('queue', {
      id: uuid(), token: token, key: key, event_id: ev.id,
      scanned_at: new Date().toISOString(), local_result: status, ticket_no: t ? t.n : ''
    });
    return {
      status: status, message: MESSAGES[status],
      detail: t ? [t.n, t.c].filter(Boolean).join(' · ') : (ev.category_restriction ? 'Billet d\'une autre porte ou inconnu' : ''),
      ticket: t ? t.n : '', source: 'offline'
    };
  }

  async function check(token) {
    token = (token || '').trim();
    if (busy || !token) return;
    var ev = currentEvent();
    if (!ev) { show('error', 'CHOISISSEZ UN ÉVÉNEMENT', ''); return; }
    busy = true;
    show('idle', 'VÉRIFICATION…', '');
    var res = null;
    try {
      var key = (await sha256hex(token)).slice(0, 32);
      if (cfg.mode !== 'offline' && navigator.onLine !== false) {
        try {
          var d = await api('/valider', { method: 'POST', body: { token: token, event_id: ev.id } }, ONLINE_TIMEOUT_MS);
          setOnline(true);
          res = { status: d.status, message: d.message, detail: [d.ticket, d.category].filter(Boolean).join(' · '),
                  ticket: d.ticket, source: 'online' };
          var local = await idb.get('tickets', ev.id + ':' + key);
          if (local && (d.status === 'accepted' || d.status === 'duplicate') && local.s !== 'used') {
            local.s = 'used';
            await idb.put('tickets', local);
          }
        } catch (e) {
          if (e instanceof ApiError && e.status < 500) {
            res = { status: 'error', message: 'REFUSÉ PAR LE SERVEUR', detail: e.message, source: 'online' };
          } else {
            setOnline(false);
          }
        }
      }
      if (!res) {
        if (!ev.offline_allowed) {
          res = { status: 'error', message: 'RÉSEAU INDISPONIBLE', detail: 'Le contrôle hors connexion est désactivé pour cet événement.' };
        } else {
          res = await validateOffline(token, key, ev);
        }
      }
    } catch (e) {
      res = { status: 'error', message: 'ERREUR', detail: e.message || String(e) };
    }
    show(res.status, res.message, res.detail, res.source === 'offline' ? 'CONTRÔLE HORS CONNEXION' : '');
    QrCamera.feedback(res.status === 'accepted');
    if (res.source) addHistory(res);
    busy = false;
    refreshStatus();
  }

  // ---------------------------------------------------------------- synchronisation
  async function syncQueue() {
    var items = await idb.all('queue');
    items.sort(function (a, b) { return a.scanned_at < b.scanned_at ? -1 : 1; });
    var conflicts = 0;
    for (var i = 0; i < items.length; i += 200) {
      var batch = items.slice(i, i + 200).map(function (s) {
        return { id: s.id, token: s.token, event_id: s.event_id, scanned_at: s.scanned_at, local_result: s.local_result };
      });
      var data = await api('/synchroniser', { method: 'POST', body: { scans: batch } }, 30000);
      for (var j = 0; j < data.results.length; j++) {
        var r = data.results[j];
        if (r.status === 'retry') continue;
        if (r.status === 'conflict') conflicts++;
        await idb.del('queue', r.id);
      }
    }
    if (conflicts) {
      show('conflict', conflicts + ' CONFLIT(S) DÉTECTÉ(S)', 'Billet(s) admis ici alors qu\'ils avaient déjà servi ailleurs. Le superviseur est prévenu.');
      QrCamera.feedback(false);
    }
  }

  async function sync() {
    if (syncing || !cfg.token) return;
    syncing = true;
    try {
      await syncQueue();
      var ev = currentEvent();
      if (ev && ev.offline_allowed && await idb.get('meta', 'manifest:' + ev.id)) await pullManifest(ev.id, true);
      setOnline(true);
    } catch (e) {
      if (e instanceof NetworkError) setOnline(false);
    } finally {
      syncing = false;
      refreshStatus();
    }
  }

  // ---------------------------------------------------------------- connexion / déconnexion
  async function registerDevice(evt) {
    evt.preventDefault();
    $('setupError').textContent = '';
    var server = $('server').value.trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) {
      $('setupError').textContent = 'L\'adresse du serveur doit commencer par https://';
      return;
    }
    cfg = { server: server };
    $('setupBtn').disabled = true;
    try {
      var data = await api('/appareils', { method: 'POST', body: {
        email: $('email').value, password: $('password').value, device_name: $('deviceName').value } }, 15000);
      cfg.token = data.token;
      cfg.deviceId = data.device_id;
      cfg.user = data.user;
      cfg.org = data.organization;
      cfg.mode = 'auto';
      saveConfig();
      $('password').value = '';
      setOnline(true);
      await showMain();
    } catch (e) {
      $('setupError').textContent = e.message || 'Connexion impossible';
    } finally { $('setupBtn').disabled = false; }
  }

  async function forgetDevice(message) {
    await idb.clearAll();
    var server = cfg.server;
    cfg = { server: server };
    saveConfig();
    showSetup(message);
  }

  async function logout() {
    var queued = await idb.count('queue');
    if (queued && !confirm(queued + ' contrôle(s) ne sont pas synchronisés et seront perdus. Déconnecter quand même ?')) return;
    if (!queued && !confirm('Déconnecter cet appareil ? Les billets chargés seront effacés.')) return;
    try { await api('/deconnexion', { method: 'POST' }, 5000); } catch (e) { /* hors ligne : le jeton expirera */ }
    await forgetDevice('Appareil déconnecté.');
  }

  // ---------------------------------------------------------------- démarrage
  async function init() {
    db = await openDb();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    camera = new QrCamera($('video'), check);
    $('setupForm').addEventListener('submit', registerDevice);
    $('logout').addEventListener('click', logout);
    $('prepare').addEventListener('click', prepare);
    $('syncNow').addEventListener('click', function () { sync(); loadEvents(); });
    $('eventSel').addEventListener('change', function () { cfg.eventId = parseInt(this.value, 10); saveConfig(); refreshStatus(); });
    $('mode').addEventListener('change', function () { cfg.mode = this.value; saveConfig(); });
    $('camStart').addEventListener('click', function () {
      camera.start().catch(function (e) { show('error', 'CAMÉRA INDISPONIBLE', e.message || String(e)); });
    });
    $('camStop').addEventListener('click', function () { camera.stop(); });
    $('manualBtn').addEventListener('click', function () { check($('manual').value); $('manual').value = ''; });
    window.addEventListener('online', sync);
    window.addEventListener('offline', function () { setOnline(false); });
    setInterval(sync, SYNC_EVERY_MS);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    if (cfg.token) await showMain(); else showSetup();
  }

  init().catch(function (e) { document.body.textContent = 'Erreur de démarrage : ' + (e.message || e); });
})();
