(function () {
  "use strict";

  // Adresse qui reçoit les demandes du formulaire : reprise du bloc Contact.
  var emailEl = document.getElementById("contact-email");
  var CONTACT_EMAIL = emailEl ? emailEl.textContent.trim() : "";

  // Menu mobile
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("site-nav");
  function setMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  // Filtre des services par domaine
  var filters = document.querySelectorAll(".filter");
  var services = document.querySelectorAll(".service");
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var domain = btn.getAttribute("data-filter");
      filters.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      services.forEach(function (card) {
        card.hidden = domain !== "all" && card.getAttribute("data-domain") !== domain;
      });
    });
  });

  // Bouton « Copier »
  document.querySelectorAll(".copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.querySelector(btn.getAttribute("data-copy"));
      if (!target) return;
      var text = target.textContent.trim();
      function selectText() {
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "Sélectionné";
      }
      var done = function () { btn.textContent = "Copié"; };
      try {
        navigator.clipboard.writeText(text).then(done, selectText);
      } catch (err) {
        selectText();
      }
      setTimeout(function () { btn.textContent = "Copier"; }, 2200);
    });
  });

  // Formulaire de contact : prépare un e-mail dans la messagerie du visiteur
  var form = document.getElementById("contact-form");
  var status = document.getElementById("form-status");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var required = form.querySelectorAll("[required]");
      var firstInvalid = null;
      required.forEach(function (field) {
        var ok = field.value.trim() !== "" && field.checkValidity();
        field.setAttribute("aria-invalid", String(!ok));
        if (!ok && !firstInvalid) firstInvalid = field;
      });
      if (firstInvalid) {
        status.className = "form-status is-error";
        status.textContent = firstInvalid.type === "email" && firstInvalid.value.trim() !== ""
          ? "L'adresse e-mail semble incomplète. Vérifiez-la puis réessayez."
          : "Merci de renseigner votre nom, votre e-mail et votre besoin.";
        firstInvalid.focus();
        return;
      }

      var data = new FormData(form);
      var subject = "Demande de devis : " + data.get("service");
      var body = [
        "Nom : " + data.get("nom"),
        "Organisation : " + (data.get("organisation") || "-"),
        "E-mail : " + data.get("email"),
        "Téléphone : " + (data.get("telephone") || "-"),
        "Service souhaité : " + data.get("service"),
        "",
        data.get("message")
      ].join("\n");

      window.location.href = "mailto:" + CONTACT_EMAIL +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);

      status.className = "form-status is-ok";
      status.textContent = "Votre messagerie devrait s'ouvrir avec le message prérempli, prêt à être envoyé. " +
        "Si rien ne s'ouvre, écrivez-nous directement à " + CONTACT_EMAIL + ".";
    });

    form.addEventListener("input", function (e) {
      if (e.target.getAttribute("aria-invalid") === "true" && e.target.value.trim() !== "") {
        e.target.setAttribute("aria-invalid", "false");
      }
    });
  }

  // Année du pied de page
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
