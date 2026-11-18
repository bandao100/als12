// Comportements communs (sans script en ligne, compatible avec la CSP stricte).
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-confirm]');
  if (el && !window.confirm(el.getAttribute('data-confirm'))) { e.preventDefault(); e.stopPropagation(); }
  if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
}, true);
