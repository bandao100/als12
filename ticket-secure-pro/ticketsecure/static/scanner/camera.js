/* Lecture de QR codes par la caméra arrière.
 * Utilise BarcodeDetector (natif sous Chrome Android) quand il existe, sinon jsQR.
 * Fonctionne sans aucune ressource externe (indispensable hors connexion). */
(function (global) {
  'use strict';

  function QrCamera(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.timer = null;
    this.lastCode = '';
    this.lastAt = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = null;
    if ('BarcodeDetector' in global) {
      try { this.detector = new global.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { this.detector = null; }
    }
  }

  QrCamera.prototype.start = async function () {
    if (this.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Caméra indisponible : ouvrez la page en HTTPS ou utilisez l\'application.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
    var self = this;
    this.timer = setInterval(function () { self.tick(); }, 180);
  };

  QrCamera.prototype.stop = function () {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); }
    this.stream = null;
    this.video.srcObject = null;
  };

  QrCamera.prototype.emit = function (code) {
    var now = Date.now();
    // Évite de traiter dix fois le même QR resté devant l'objectif.
    if (!code || (code === this.lastCode && now - this.lastAt < 3000)) return;
    this.lastCode = code;
    this.lastAt = now;
    this.onCode(code.trim());
  };

  QrCamera.prototype.tick = async function () {
    var v = this.video;
    if (this.busy || !v.videoWidth) return;
    this.busy = true;
    try {
      if (this.detector) {
        var codes = await this.detector.detect(v);
        if (codes.length) this.emit(codes[0].rawValue);
      } else if (global.jsQR) {
        var w = Math.min(v.videoWidth, 800), h = Math.round(v.videoHeight * w / v.videoWidth);
        this.canvas.width = w; this.canvas.height = h;
        this.ctx.drawImage(v, 0, 0, w, h);
        var img = this.ctx.getImageData(0, 0, w, h);
        var found = global.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (found) this.emit(found.data);
      }
    } catch (e) { /* image illisible : on continue */ }
    this.busy = false;
  };

  /* Retour sonore et vibration selon le résultat. */
  QrCamera.feedback = function (ok) {
    try { if (navigator.vibrate) navigator.vibrate(ok ? 120 : [80, 60, 80, 60, 200]); } catch (e) {}
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      QrCamera._audio = QrCamera._audio || new Ctx();
      var ctx = QrCamera._audio, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = ok ? 880 : 220;
      osc.type = ok ? 'sine' : 'square';
      gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + (ok ? 0.15 : 0.45));
    } catch (e) {}
  };

  global.QrCamera = QrCamera;
})(window);
