(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasObserver = "IntersectionObserver" in window;

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

  // En-tête et bouton « retour en haut » selon le défilement
  var header = document.querySelector(".site-header");
  var toTop = document.getElementById("to-top");
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 8);
    if (toTop) toTop.classList.toggle("is-visible", y > 700);
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
  if (toTop) {
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  // Lien du menu correspondant à la section affichée
  if (hasObserver && nav) {
    var navLinks = nav.querySelectorAll('a[href^="#"]:not(.btn)');
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = "#" + entry.target.id;
        navLinks.forEach(function (link) {
          link.classList.toggle("is-current", link.getAttribute("href") === id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section[id]").forEach(function (section) { spy.observe(section); });
  }

  // Filtre des services par famille
  var filters = document.querySelectorAll(".filter");
  var services = document.querySelectorAll(".service");
  function applyFilter(domain) {
    filters.forEach(function (b) {
      var active = b.getAttribute("data-filter") === domain;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    services.forEach(function (card) {
      var show = domain === "all" || card.getAttribute("data-domain") === domain;
      var wasHidden = card.hidden;
      card.hidden = !show;
      if (show && wasHidden && !reduceMotion) {
        card.classList.remove("is-entering");
        void card.offsetWidth;
        card.classList.add("is-entering");
      }
    });
  }
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () { applyFilter(btn.getAttribute("data-filter")); });
  });

  // Titre qui fait défiler les métiers, relié au schéma
  var rotator = document.getElementById("rotator");
  var hubNodes = document.querySelectorAll(".hub-node");
  var hubLinks = document.querySelectorAll(".hub-link");
  var items = rotator ? Array.prototype.slice.call(rotator.children) : [];
  var current = 0;
  var timer = null;
  var heroVisible = true;
  var userHold = false;

  function highlight(key) {
    hubNodes.forEach(function (n) { n.classList.toggle("is-active", n.getAttribute("data-key") === key); });
    hubLinks.forEach(function (l) { l.classList.toggle("is-active", l.getAttribute("data-key") === key); });
  }
  function show(index) {
    if (!items.length || index === current) return;
    var leaving = items[current];
    leaving.classList.remove("is-current");
    leaving.classList.add("is-leaving");
    setTimeout(function () { leaving.classList.remove("is-leaving"); }, 450);
    var next = items[index];
    next.classList.remove("is-leaving");
    next.classList.add("is-current");
    current = index;
    highlight(next.getAttribute("data-key"));
  }
  function indexOfKey(key) {
    for (var i = 0; i < items.length; i++) if (items[i].getAttribute("data-key") === key) return i;
    return 0;
  }
  function start() {
    if (reduceMotion || timer || userHold || !heroVisible || document.hidden || items.length < 2) return;
    timer = setInterval(function () { show((current + 1) % items.length); }, 2600);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function goToService(key) {
    var card = document.getElementById("svc-" + key);
    if (!card) return;
    if (card.hidden) applyFilter("all");
    card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    card.setAttribute("tabindex", "-1");
    card.focus({ preventScroll: true });
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    setTimeout(function () { card.classList.remove("is-flash"); }, 1700);
  }

  hubNodes.forEach(function (node) {
    var key = node.getAttribute("data-key");
    function hold() { userHold = true; stop(); show(indexOfKey(key)); highlight(key); }
    function release() { userHold = false; start(); }
    node.addEventListener("mouseenter", hold);
    node.addEventListener("focus", hold);
    node.addEventListener("mouseleave", release);
    node.addEventListener("blur", release);
    node.addEventListener("click", function (e) {
      e.preventDefault();
      goToService(key);
    });
  });

  if (rotator) {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });
    var hero = document.getElementById("accueil");
    if (hasObserver && hero) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        if (heroVisible) start(); else stop();
      }).observe(hero);
    }
    setTimeout(start, 1200);
  }

  // Apparition douce des blocs situés plus bas dans la page
  if (!reduceMotion && hasObserver) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add("is-revealing");
        el.classList.remove("reveal-pending");
        revealIO.unobserve(el);
        setTimeout(function () { el.classList.remove("is-revealing"); }, 1600);
      });
    }, { rootMargin: "0px 0px -8% 0px" });

    var limit = window.innerHeight * 0.92;
    document.querySelectorAll("[data-reveal]").forEach(function (el) {
      if (el.getBoundingClientRect().top < limit) return;
      var siblings = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.hasAttribute("data-reveal"); });
      el.style.setProperty("--rd", (siblings.indexOf(el) % 3) * 0.09 + "s");
      el.classList.add("reveal-pending");
      revealIO.observe(el);
    });
  }

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
