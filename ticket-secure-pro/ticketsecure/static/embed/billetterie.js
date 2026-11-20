/*! Ticket Secure Pro — widget de billetterie intégrable.
 *
 * Intégration (deux lignes, dans n'importe quelle page) :
 *   <script src="https://VOTRE-PLATEFORME/static/embed/billetterie.js" defer></script>
 *   <tsp-billetterie organisateur="mon-organisation"></tsp-billetterie>
 *
 * Attributs facultatifs :
 *   organisateur="slug"            n'affiche que les événements de cet organisateur
 *   evenement="organisateur/slug"  ouvre directement la réservation d'un événement
 *   couleur="#e4572e"              couleur principale
 *   titre="Nos événements"         titre du catalogue
 *   filtres="non"                  masque recherche et filtres
 *   serveur="https://…"            adresse de la plateforme (par défaut : celle du script)
 *
 * Sécurité : le widget vit dans un Shadow DOM (aucun conflit de style avec le site),
 * n'utilise aucun cookie, et n'insère jamais de données sous forme de HTML.
 * Le paiement se fait sur la page de l'opérateur ; le client revient ensuite sur
 * cette page (?tsp_commande=…) où ses billets s'affichent.
 */
(function () {
  'use strict';
  if (!window.customElements || customElements.get('tsp-billetterie')) return;

  var SCRIPT_ORIGIN = (function () {
    try { return new URL(document.currentScript.src).origin; } catch (e) { return location.origin; }
  })();
  var STORE_KEY = 'tsp.billetterie.commandes';
  var MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

  // ------------------------------------------------------------------ utilitaires DOM
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function money(amount, currency) {
    var n = Math.round(amount || 0).toLocaleString('fr-FR');
    return n + ' ' + (currency === 'XOF' || currency === 'XAF' ? 'F CFA' : currency);
  }

  function loadOrders() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function saveOrder(entry) {
    var list = loadOrders().filter(function (o) { return o.ref !== entry.ref; });
    list.unshift(entry);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* navigation privée */ }
  }
  function findOrder(ref) {
    return loadOrders().filter(function (o) { return o.ref === ref; })[0] || null;
  }

  // Adresse de la page actuelle sans les paramètres du widget (l'ancre est conservée :
  // les sites « une page » y gardent leur route).
  function cleanUrl() {
    var url = new URL(location.href);
    url.searchParams.delete('tsp_commande');
    url.searchParams.delete('tsp_annule');
    return url.toString();
  }

  // N'accepte que des liens http(s) venant de l'API (jamais javascript:, data:…).
  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
  }

  // ------------------------------------------------------------------ composant
  class TspBilletterie extends HTMLElement {
    connectedCallback() {
      if (this._started) return;
      this._started = true;
      this.server = (this.getAttribute('serveur') || SCRIPT_ORIGIN).replace(/\/+$/, '');
      this.org = (this.getAttribute('organisateur') || '').trim();
      this.single = (this.getAttribute('evenement') || '').trim();
      this.showFilters = (this.getAttribute('filtres') || 'oui').toLowerCase() !== 'non';
      this.filters = { q: '', genre: '', ville: '' };
      this.page = 1;

      var color = this.getAttribute('couleur') || '';
      if (/^#[0-9a-fA-F]{3,8}$/.test(color)) this.style.setProperty('--tsp-accent', color);
      this.style.display = 'block';
      this.style.visibility = 'hidden'; // évite l'affichage sans style
      var self = this;
      var root = this.attachShadow({ mode: 'open' });
      var css = h('link', { rel: 'stylesheet', href: this.server + '/static/embed/billetterie.css' });
      var reveal = function () { self.style.visibility = 'visible'; };
      css.addEventListener('load', reveal);
      css.addEventListener('error', reveal);
      setTimeout(reveal, 2500);
      this.view = h('div', { class: 'tsp', 'aria-live': 'polite' });
      root.appendChild(css);
      root.appendChild(this.view);
      this.start();
    }

    async start() {
      this.loading();
      try {
        this.config = await this.api('/config');
      } catch (e) {
        return this.fail('La billetterie est momentanément indisponible.', this.start.bind(this));
      }
      var params = new URLSearchParams(location.search);
      var ref = params.get('tsp_commande');
      if (ref) {
        // Retour depuis la page de paiement de l'opérateur.
        try { history.replaceState(history.state, '', cleanUrl()); } catch (e) { /* ignoré */ }
        return this.showOrder(ref, true, params.get('tsp_annule') === '1');
      }
      if (this.single && this.single.indexOf('/') > 0) {
        var parts = this.single.split('/');
        return this.showEvent(parts[0], parts[1]);
      }
      return this.showCatalogue();
    }

    // -------------------------------------------------------------- réseau
    async api(path, options) {
      options = options || {};
      var resp = await fetch(this.server + '/api/public/v1' + path, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: 'omit', cache: 'no-store'
      });
      var data = {};
      try { data = await resp.json(); } catch (e) { /* vide */ }
      if (!resp.ok || data.ok === false) {
        var err = new Error(data.message || 'Erreur ' + resp.status);
        err.status = resp.status;
        throw err;
      }
      return data;
    }

    // -------------------------------------------------------------- états génériques
    render(nodes) {
      this.results = null;
      this.view.textContent = '';
      nodes.forEach(function (n) { if (n) this.view.appendChild(n); }, this);
    }
    scrollTop() {
      var rect = this.getBoundingClientRect();
      if (rect.top < 0 || rect.top > window.innerHeight * 0.6) this.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    loading(text) {
      this.render([h('div', { class: 'state' }, [h('div', { class: 'spinner' }), h('p', { text: text || 'Chargement…' })])]);
    }
    fail(message, retry) {
      this.render([h('div', { class: 'state' }, [
        h('p', { class: 'error', text: message }),
        retry ? h('button', { class: 'btn', text: 'Réessayer', onclick: retry }) : null
      ])]);
    }
    backButton(label, action) {
      return h('button', { class: 'back', onclick: action }, ['← ' + label]);
    }
    header(title) {
      var orders = loadOrders();
      return h('div', { class: 'head' }, [
        h('h2', { text: title }),
        orders.length ? h('button', { class: 'btn ghost', onclick: this.showMyTickets.bind(this) },
          ['Mes billets (' + orders.length + ')']) : null
      ]);
    }

    // -------------------------------------------------------------- catalogue
    async showCatalogue(append) {
      var self = this;
      if (!this.results) {
        // Squelette construit une seule fois : la barre de filtres garde le focus pendant la saisie.
        this.loading();
        if (this.showFilters && !this.cities) {
          try {
            this.cities = (await this.api('/villes' + (this.org ? '?organisateur=' + encodeURIComponent(this.org) : ''))).cities;
          } catch (e) { this.cities = []; }
        }
        var results = h('div', { class: 'results' });
        this.render([
          this.header(this.getAttribute('titre') || 'Billetterie'),
          this.showFilters ? this.filterBar() : null,
          results
        ]);
        this.results = results;
        append = false;
      }
      var box = this.results;
      if (!append) {
        this.page = 1;
        box.textContent = '';
        box.appendChild(h('div', { class: 'state' }, [h('div', { class: 'spinner' })]));
      }
      var params = new URLSearchParams({ page: String(this.page), par_page: '12' });
      if (this.org) params.set('organisateur', this.org);
      Object.keys(this.filters).forEach(function (k) { if (self.filters[k]) params.set(k, self.filters[k]); });
      var noFilter = !this.filters.q && !this.filters.genre && !this.filters.ville;
      var requestId = (this.requestId = (this.requestId || 0) + 1);
      var list, featured = { events: [] };
      try {
        var calls = [this.api('/evenements?' + params)];
        if (!append && noFilter) {
          var fp = new URLSearchParams({ a_la_une: '1', par_page: '8' });
          if (this.org) fp.set('organisateur', this.org);
          calls.push(this.api('/evenements?' + fp));
        }
        var res = await Promise.all(calls);
        list = res[0];
        if (res[1]) featured = res[1];
      } catch (e) {
        if (requestId !== this.requestId || box !== this.results) return;
        box.textContent = '';
        box.appendChild(h('div', { class: 'state' }, [h('p', { class: 'error', text: 'Impossible de charger les événements.' }),
          h('button', { class: 'btn', text: 'Réessayer', onclick: function () { self.showCatalogue(); } })]));
        return;
      }
      // Une réponse plus ancienne que la dernière recherche est ignorée.
      if (requestId !== this.requestId || box !== this.results) return;
      if (append && this.grid) {
        list.events.forEach(function (ev) { self.grid.appendChild(self.card(ev)); });
      } else {
        box.textContent = '';
        if (featured.events.length) box.appendChild(this.featuredRow(featured.events));
        this.grid = h('div', { class: 'grid' }, list.events.map(this.card.bind(this)));
        box.appendChild(list.events.length ? this.grid : h('p', { class: 'empty', text: noFilter
          ? 'Aucun événement en vente pour le moment.' : 'Aucun événement ne correspond à votre recherche.' }));
        this.more = h('div', { class: 'more' });
        box.appendChild(this.more);
      }
      this.more.textContent = '';
      if (list.page < list.pages) {
        this.more.appendChild(h('button', { class: 'btn ghost', text: 'Voir plus d\'événements', onclick: function () {
          self.page += 1;
          self.showCatalogue(true);
        } }));
      }
    }

    filterBar() {
      var self = this;
      var timer;
      var search = h('input', { type: 'search', placeholder: 'Rechercher un événement, un lieu, un artiste…',
        'aria-label': 'Rechercher', value: this.filters.q });
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { self.filters.q = search.value.trim(); self.showCatalogue(); }, 350);
      });
      var city = h('select', { 'aria-label': 'Ville' }, [h('option', { value: '', text: 'Toutes les villes' })]
        .concat((this.cities || []).map(function (c) {
          return h('option', { value: c, text: c, selected: c === self.filters.ville });
        })));
      city.addEventListener('change', function () { self.filters.ville = city.value; self.showCatalogue(); });
      var chips = [{ code: '', label: 'Tout' }].concat(this.config.genres).map(function (g) {
        var chip = h('button', { class: 'chip' + (self.filters.genre === g.code ? ' active' : ''), text: g.label });
        chip.addEventListener('click', function () {
          self.filters.genre = g.code;
          chips.forEach(function (c) { c.classList.toggle('active', c === chip); });
          self.showCatalogue();
        });
        return chip;
      });
      return h('div', { class: 'filters' }, [h('div', { class: 'searchrow' }, [search, city]), h('div', { class: 'chips' }, chips)]);
    }

    featuredRow(events) {
      var self = this;
      return h('section', { class: 'featured' }, [
        h('h3', { text: 'À la une' }),
        h('div', { class: 'strip' }, events.map(function (ev) {
          return h('button', { class: 'feature', onclick: function () { self.showEvent(ev.organizer.slug, ev.slug); } }, [
            self.poster(ev),
            h('span', { class: 'featuretext' }, [
              h('span', { class: 'genre', text: ev.genre_label }),
              h('strong', { text: ev.name }),
              h('span', { text: ev.starts_label + (ev.city ? ' · ' + ev.city : '') })
            ])
          ]);
        }))
      ]);
    }

    poster(ev) {
      if (safeUrl(ev.poster_url)) return h('img', { src: ev.poster_url, alt: '', loading: 'lazy' });
      return h('span', { class: 'noposter g-' + ev.genre, text: (ev.name || '?').charAt(0).toUpperCase() });
    }

    card(ev) {
      var self = this;
      var d = new Date(ev.starts_at);
      return h('button', { class: 'card', onclick: function () { self.showEvent(ev.organizer.slug, ev.slug); },
        'aria-label': ev.name }, [
        h('span', { class: 'poster' }, [
          this.poster(ev),
          h('span', { class: 'date' }, [h('b', { text: String(d.getDate()) }), h('small', { text: MONTHS[d.getMonth()] })]),
          h('span', { class: 'genre', text: ev.genre_label }),
          ev.sold_out ? h('span', { class: 'soldout', text: 'COMPLET' }) : null
        ]),
        h('span', { class: 'body' }, [
          h('strong', { text: ev.name }),
          h('span', { class: 'muted', text: ev.starts_label.split(' à ')[1] + ' · ' + [ev.venue, ev.city].filter(Boolean).join(', ') }),
          this.org ? null : h('span', { class: 'muted small', text: ev.organizer.name }),
          h('span', { class: 'price', text: ev.min_price_label ? (ev.min_price === 0 ? 'Gratuit' : 'Dès ' + ev.min_price_label) : '' })
        ])
      ]);
    }

    // -------------------------------------------------------------- fiche événement
    async showEvent(orgSlug, eventSlug) {
      var self = this;
      this.loading();
      this.scrollTop();
      var data;
      try {
        data = await this.api('/evenements/' + encodeURIComponent(orgSlug) + '/' + encodeURIComponent(eventSlug));
      } catch (e) {
        return this.fail(e.status === 404 ? 'Cet événement n\'est plus disponible.' : 'Impossible de charger l\'événement.',
          this.single ? null : function () { self.showCatalogue(); });
      }
      var ev = data.event;
      var cart = {};
      var maxTotal = ev.max_per_order;
      var totalEl = h('strong', { class: 'total', text: '—' });
      var go = h('button', { class: 'btn', text: 'Continuer', disabled: true });
      function count() { return Object.keys(cart).reduce(function (s, k) { return s + cart[k]; }, 0); }
      function amount() {
        return ev.categories.reduce(function (s, c) { return s + (cart[c.id] || 0) * c.price; }, 0);
      }
      function refresh() {
        var n = count();
        totalEl.textContent = n ? money(amount(), self.config.currency) + ' · ' + n + ' billet' + (n > 1 ? 's' : '') : '—';
        go.disabled = n === 0;
      }
      var rows = ev.categories.map(function (c) {
        var limit = c.available === null ? maxTotal : Math.min(maxTotal, c.available);
        var qty = h('span', { class: 'qty', text: '0' });
        function set(delta) {
          var next = Math.max(0, Math.min(limit, (cart[c.id] || 0) + delta));
          if (delta > 0 && count() >= maxTotal) return;
          cart[c.id] = next;
          qty.textContent = String(next);
          refresh();
        }
        return h('div', { class: 'cat' + (limit === 0 ? ' disabled' : '') }, [
          h('div', {}, [h('strong', { text: c.name }), h('span', { class: 'muted small',
            text: c.price_label + (c.available !== null ? ' · ' + (c.available ? c.available + ' restant(s)' : 'épuisé') : '') })]),
          h('div', { class: 'stepper' }, [
            h('button', { 'aria-label': 'Retirer un billet ' + c.name, text: '−', onclick: function () { set(-1); }, disabled: limit === 0 }),
            qty,
            h('button', { 'aria-label': 'Ajouter un billet ' + c.name, text: '+', onclick: function () { set(1); }, disabled: limit === 0 })
          ])
        ]);
      });
      go.addEventListener('click', function () {
        var items = ev.categories.filter(function (c) { return cart[c.id]; })
          .map(function (c) { return { category: c, quantity: cart[c.id] }; });
        self.showCheckout(ev, items);
      });

      var buy;
      if (!ev.on_sale) buy = h('p', { class: 'notice', text: 'Les ventes en ligne sont fermées pour cet événement.' });
      else if (ev.sold_out) buy = h('p', { class: 'notice', text: 'Cet événement est complet.' });
      else buy = h('div', { class: 'buy' }, [h('h3', { text: 'Choisissez vos billets' })].concat(rows).concat([
        h('div', { class: 'totalrow' }, [h('span', { text: 'Total' }), totalEl]), go,
        h('p', { class: 'muted small', text: 'Maximum ' + maxTotal + ' billets par commande. Paiement : ' +
          (ev.providers.map(function (p) { return p.label; }).join(', ') || 'non configuré') + '.' })
      ]));

      this.render([
        this.single ? null : this.backButton('Tous les événements', function () { self.showCatalogue(); }),
        h('div', { class: 'detail' }, [
          h('div', { class: 'info' }, [
            h('div', { class: 'banner' }, [this.poster(ev)]),
            h('p', { class: 'eyebrow', text: ev.genre_label + ' · ' + ev.organizer.name }),
            h('h2', { text: ev.name }),
            h('p', { class: 'when', text: ev.starts_label }),
            h('p', { class: 'muted', text: [ev.venue, ev.city].filter(Boolean).join(', ') }),
            ev.description ? h('p', { class: 'desc', text: ev.description }) : null
          ]),
          buy
        ])
      ]);
    }

    // -------------------------------------------------------------- paiement
    showCheckout(ev, items) {
      var self = this;
      this.scrollTop();
      var total = items.reduce(function (s, i) { return s + i.quantity * i.category.price; }, 0);
      var name = h('input', { name: 'name', autocomplete: 'name', required: true, maxlength: '160' });
      var email = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true });
      var phone = h('input', { name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '+226 70 00 00 00' });
      var terms = h('input', { type: 'checkbox', required: true });
      var errorBox = h('p', { class: 'error', role: 'alert' });
      var providers = total > 0 ? ev.providers : [];
      var radios = providers.map(function (p, i) {
        return h('label', { class: 'provider' }, [
          h('input', { type: 'radio', name: 'provider', value: p.code, checked: i === 0 }),
          h('span', {}, [h('strong', { text: p.label }), h('small', { text: p.description })])
        ]);
      });
      var pay = h('button', { class: 'btn', type: 'submit',
        text: total > 0 ? 'Payer ' + money(total, self.config.currency) : 'Recevoir mes billets' });

      var form = h('form', { class: 'form', novalidate: true }, [
        h('label', {}, ['Nom complet', name]),
        h('label', {}, ['E-mail (réception des billets)', email]),
        h('label', {}, ['Téléphone', phone]),
        total > 0 ? h('fieldset', { class: 'providers' }, [h('legend', { text: 'Moyen de paiement' })].concat(
          radios.length ? radios : [h('p', { class: 'error', text: 'Aucun moyen de paiement n\'est configuré.' })])) : null,
        h('label', { class: 'check' }, [terms, h('span', {}, ['J\'accepte les ',
          h('a', { href: self.server + '/conditions', target: '_blank', rel: 'noopener', text: 'conditions de vente' })])]),
        errorBox, pay,
        h('p', { class: 'muted small', text: 'Vous serez redirigé vers la page sécurisée de l\'opérateur, puis ramené ici où vos billets s\'afficheront. Ils vous sont aussi envoyés par e-mail.' })
      ]);

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorBox.textContent = '';
        if (!name.value.trim() || !email.checkValidity() || !email.value) { errorBox.textContent = 'Indiquez votre nom et une adresse e-mail valide.'; return; }
        if (!terms.checked) { errorBox.textContent = 'Merci d\'accepter les conditions de vente.'; return; }
        var chosen = form.querySelector('input[name="provider"]:checked');
        if (total > 0 && !chosen) { errorBox.textContent = 'Choisissez un moyen de paiement.'; return; }
        pay.disabled = true;
        pay.textContent = 'Préparation du paiement…';
        try {
          var res = await self.api('/commandes', { method: 'POST', body: {
            event_id: ev.id,
            items: items.map(function (i) { return { category_id: i.category.id, quantity: i.quantity }; }),
            customer: { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() },
            provider: chosen ? chosen.value : '',
            accept_terms: true,
            return_url: cleanUrl()
          } });
          saveOrder({ ref: res.ref, key: res.key, event: ev.name, date: ev.starts_label,
            org: ev.organizer.slug, slug: ev.slug, created: new Date().toISOString() });
          if (res.payment_url) {
            if (!safeUrl(res.payment_url)) throw new Error('Adresse de paiement invalide.');
            pay.textContent = 'Redirection vers le paiement…';
            window.location.assign(res.payment_url);
          } else {
            self.showOrder(res.ref, true);
          }
        } catch (err) {
          errorBox.textContent = err.message || 'Commande impossible. Réessayez.';
          pay.disabled = false;
          pay.textContent = total > 0 ? 'Payer ' + money(total, self.config.currency) : 'Recevoir mes billets';
        }
      });

      this.render([
        this.backButton('Modifier mes billets', function () { self.showEvent(ev.organizer.slug, ev.slug); }),
        h('div', { class: 'detail' }, [
          h('div', { class: 'summary' }, [
            h('p', { class: 'eyebrow', text: 'Votre commande' }),
            h('h2', { text: ev.name }),
            h('p', { class: 'when', text: ev.starts_label + ' · ' + [ev.venue, ev.city].filter(Boolean).join(', ') }),
            h('div', { class: 'lines' }, items.map(function (i) {
              return h('div', { class: 'line' }, [h('span', { text: i.quantity + ' × ' + i.category.name }),
                h('span', { text: money(i.quantity * i.category.price, self.config.currency) })]);
            }).concat([h('div', { class: 'line totalline' }, [h('span', { text: 'Total' }), h('strong', { text: money(total, self.config.currency) })])]))
          ]),
          form
        ])
      ]);
      name.focus({ preventScroll: true });
    }

    // -------------------------------------------------------------- retour et billets
    async showOrder(ref, fromPayment, cancelled) {
      var self = this;
      var entry = findOrder(ref);
      var back = this.single ? null : this.backButton('Tous les événements', function () { self.showCatalogue(); });
      if (!entry) {
        // Commande passée sur un autre appareil ou navigateur : la clé d'accès n'est pas ici.
        return this.render([back, h('div', { class: 'state' }, [
          h('h2', { text: 'Commande ' + ref }),
          h('p', { text: 'Dès que le paiement est confirmé, vos billets vous sont envoyés par e-mail (pensez aux courriers indésirables).' })
        ])]);
      }
      this.scrollTop();
      var attempts = 0;
      var poll = async function () {
        var data;
        try {
          data = await self.api('/commandes/' + encodeURIComponent(ref) + '?cle=' + encodeURIComponent(entry.key));
        } catch (e) {
          if (attempts++ < 20) { setTimeout(poll, 3000); return; }
          return self.fail('Impossible de vérifier la commande. Vos billets vous seront envoyés par e-mail dès confirmation.');
        }
        if (data.status === 'pending' && cancelled) {
          // Le client est revenu par « annuler » : on ne le fait pas attendre.
          return self.render([back, h('div', { class: 'state' }, [
            h('h2', { text: 'Paiement non finalisé' }),
            h('p', { text: 'Si vous avez annulé, aucun montant n\'a été débité. Si vous avez payé, la confirmation peut prendre quelques instants.' }),
            h('div', { class: 'actions' }, [
              h('button', { class: 'btn', text: 'Vérifier à nouveau', onclick: function () { cancelled = false; attempts = 0; self.loading('Vérification du paiement…'); poll(); } }),
              entry.org && entry.slug ? h('button', { class: 'btn ghost', text: 'Recommencer la réservation',
                onclick: function () { self.showEvent(entry.org, entry.slug); } }) : null
            ]),
            h('p', { class: 'muted small', text: 'Commande ' + ref })
          ])]);
        }
        if (data.status === 'pending' && attempts++ < 40) {
          self.render([h('div', { class: 'state' }, [h('div', { class: 'spinner' }),
            h('p', { text: 'Paiement en cours de confirmation par l\'opérateur…' }),
            h('p', { class: 'muted small', text: 'Commande ' + ref + '. Ne fermez pas cette page.' })])]);
          setTimeout(poll, 3000);
          return;
        }
        self.renderOrder(data, fromPayment);
      };
      this.loading('Vérification du paiement…');
      poll();
    }

    renderOrder(data, fromPayment) {
      var self = this;
      var back = this.single ? null : this.backButton('Tous les événements', function () { self.showCatalogue(); });
      if (data.status !== 'paid') {
        var msg = data.status === 'pending'
          ? 'La confirmation du paiement prend plus de temps que prévu. Vos billets vous seront envoyés par e-mail dès qu\'elle arrivera.'
          : 'Le paiement n\'a pas abouti : aucun billet n\'a été émis et rien n\'a été débité pour cette commande.';
        return this.render([back, h('div', { class: 'state' }, [
          h('h2', { text: data.status === 'pending' ? 'Paiement en attente' : 'Paiement non abouti' }),
          h('p', { text: msg }),
          h('p', { class: 'muted small', text: 'Commande ' + data.ref })
        ])]);
      }
      this.render([
        back,
        h('div', { class: 'success' }, [
          h('p', { class: 'eyebrow', text: fromPayment ? 'Paiement confirmé' : 'Commande ' + data.ref }),
          h('h2', { text: 'Vos billets · ' + data.event.name }),
          h('p', { class: 'when', text: data.event.starts_label + ' · ' + [data.event.venue, data.event.city].filter(Boolean).join(', ') }),
          h('p', { class: 'muted', text: 'Une copie a été envoyée à ' + data.customer_email + '. Présentez chaque QR code à l\'entrée : une seule entrée par billet.' }),
          h('div', { class: 'actions' }, [
            safeUrl(data.pdf_url) ? h('a', { class: 'btn', href: data.pdf_url, target: '_blank', rel: 'noopener', text: 'Télécharger les billets (PDF)' }) : null,
            safeUrl(data.order_url) ? h('a', { class: 'btn ghost', href: data.order_url, target: '_blank', rel: 'noopener', text: 'Ouvrir sur la billetterie' }) : null
          ])
        ]),
        h('div', { class: 'tickets' }, data.tickets.map(function (t) {
          return h('div', { class: 'ticket' + (t.status !== 'valid' ? ' off' : '') }, [
            safeUrl(t.qr_url) ? h('img', { src: t.qr_url, alt: 'QR code du billet ' + t.number }) : h('span', { class: 'void', text: 'ANNULÉ' }),
            h('div', {}, [h('strong', { text: t.number }), h('span', { class: 'muted', text: t.category }),
              t.status === 'used' ? h('span', { class: 'badge', text: 'Déjà utilisé' }) : null])
          ]);
        }))
      ]);
    }

    showMyTickets() {
      var self = this;
      this.scrollTop();
      var orders = loadOrders();
      this.render([
        this.backButton('Retour', function () { self.single ? self.start() : self.showCatalogue(); }),
        h('h2', { text: 'Mes billets sur cet appareil' }),
        h('div', { class: 'orders' }, orders.map(function (o) {
          return h('button', { class: 'orderrow', onclick: function () { self.showOrder(o.ref, false); } }, [
            h('strong', { text: o.event }), h('span', { class: 'muted small', text: o.date + ' · commande ' + o.ref })
          ]);
        })),
        h('p', { class: 'muted small', text: 'Vos billets sont aussi dans l\'e-mail reçu après le paiement.' })
      ]);
    }
  }

  customElements.define('tsp-billetterie', TspBilletterie);
})();
