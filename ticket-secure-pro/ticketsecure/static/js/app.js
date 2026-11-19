// Comportements communs (sans script en ligne, compatible avec la CSP stricte).
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-confirm]');
  if (el && !window.confirm(el.getAttribute('data-confirm'))) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
  var copy = e.target.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    var source = document.getElementById(copy.getAttribute('data-copy'));
    if (source && navigator.clipboard) {
      navigator.clipboard.writeText(source.textContent).then(function () {
        var label = copy.textContent;
        copy.textContent = 'Copié ✓';
        setTimeout(function () { copy.textContent = label; }, 1600);
      });
    }
  }
}, true);
