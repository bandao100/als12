// Calcul du total sur la page de réservation.
(function () {
  var form = document.getElementById('checkout');
  if (!form) return;
  var totalEl = document.getElementById('total');
  var max = parseInt(form.dataset.max, 10) || 10;
  function fmt(n) { return n.toLocaleString('fr-FR') + ' F CFA'; }
  function update() {
    var total = 0, qty = 0;
    form.querySelectorAll('tr[data-price]').forEach(function (row) {
      var q = parseInt(row.querySelector('.qty').value, 10) || 0;
      qty += q; total += q * parseInt(row.dataset.price, 10);
    });
    totalEl.textContent = qty ? fmt(total) + ' (' + qty + ' billet' + (qty > 1 ? 's' : '') + ')' : '—';
    totalEl.style.color = qty > max ? '#ad2929' : '';
  }
  form.addEventListener('input', update);
  update();
})();
