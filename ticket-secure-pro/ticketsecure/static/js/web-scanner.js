// Scanner en ligne de l'espace web (session + jeton CSRF).
(function () {
  var root = document.getElementById('web-scanner');
  if (!root) return;
  var url = root.dataset.validateUrl;
  var csrf = document.querySelector('meta[name="csrf-token"]').content;
  var box = document.getElementById('result');
  var eventSel = document.getElementById('event');
  var busy = false;

  function show(status, message, detail) {
    box.className = 'result ' + status;
    box.textContent = message;
    var p = document.createElement('p');
    p.textContent = detail || '';
    box.appendChild(p);
  }

  async function check(token) {
    if (busy || !token) return;
    busy = true;
    show('', 'VÉRIFICATION…', '');
    try {
      var r = await fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ token: token, event_id: eventSel.value || null })
      });
      var d = await r.json();
      show(d.status || 'error', d.message || 'ERREUR', [d.ticket, d.category, d.event].filter(Boolean).join(' · '));
      QrCamera.feedback(d.ok);
    } catch (e) {
      show('error', 'ERREUR RÉSEAU', 'Vérifiez la connexion ou passez au scanner hors connexion.');
      QrCamera.feedback(false);
    } finally { busy = false; }
  }

  var cam = new QrCamera(document.getElementById('video'), check);
  document.getElementById('start').addEventListener('click', function () {
    cam.start().catch(function (e) { show('error', 'CAMÉRA INDISPONIBLE', String(e.message || e)); });
  });
  document.getElementById('stop').addEventListener('click', function () { cam.stop(); });
  document.getElementById('manualBtn').addEventListener('click', function () {
    var v = document.getElementById('manual').value.trim();
    if (v) check(v);
  });
})();
