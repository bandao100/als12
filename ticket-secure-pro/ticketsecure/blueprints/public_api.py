"""API publique de la billetterie, utilisée par le widget intégrable et par tout site partenaire.

Lecture (catalogue, fiche, statut d'une commande) : ouverte à toutes les origines,
sans cookie. Création d'une commande : seulement depuis une origine autorisée
(déclarée par l'organisateur dans « Intégration », ou par la plateforme via
EMBED_ORIGINS), et le client n'est renvoyé après paiement que vers une page de
cette origine (aucune redirection ouverte).

    GET  /api/public/v1/config
    GET  /api/public/v1/evenements?q=&genre=&ville=&organisateur=&a_la_une=1&page=
    GET  /api/public/v1/villes
    GET  /api/public/v1/evenements/<organisateur>/<evenement>
    POST /api/public/v1/commandes
    GET  /api/public/v1/commandes/<ref>?cle=<clé>
"""
from datetime import timedelta
from urllib.parse import urlsplit

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func, or_, select

from ..delivery import order_access_key, order_page_url, send_order_tickets
from ..extensions import db
from ..models import GENRES, Event, Order, Organization, utcnow
from ..orders import OrderError, confirm_payment, create_order, mark_failed, return_redirect
from ..payments import PaymentError, enabled_providers, get_provider
from ..payments.base import external_url
from ..security import constant_equals, rate_hit, rate_limited
from ..tickets import available
from ..utils import fmt_dt, money, valid_email, valid_phone

bp = Blueprint("public_api", __name__, url_prefix="/api/public/v1")

MAX_PAGE_SIZE = 48


# --- Origines autorisées -------------------------------------------------------------------
def _origin_of(url):
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("https", "http") or not parts.hostname:
        return None
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1"):
        return None  # HTTPS obligatoire, sauf essais locaux
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{parts.hostname}{port}"


def own_origin():
    base = current_app.config.get("PUBLIC_BASE_URL") or request.host_url
    return _origin_of(base)


def origins_for(org):
    allowed = set(current_app.config["EMBED_ORIGINS"]) | {own_origin()}
    if org is not None:
        allowed |= set(org.embed_origin_list)
    return {o for o in allowed if o}


def all_embed_origins():
    rows = db.session.scalars(select(Organization.embed_origins).where(
        Organization.status == "active", Organization.embed_origins != "")).all()
    allowed = set(current_app.config["EMBED_ORIGINS"]) | {own_origin()}
    for text in rows:
        allowed |= {o.strip().rstrip("/") for o in text.splitlines() if o.strip()}
    return allowed


def add_cors_headers(response):
    h = response.headers
    origin = request.headers.get("Origin")
    is_order_creation = request.endpoint == "public_api.create_order" or (
        request.method == "OPTIONS" and request.path.rstrip("/").endswith("/commandes"))
    if is_order_creation:
        if origin and origin in all_embed_origins():
            h["Access-Control-Allow-Origin"] = origin
            h["Vary"] = "Origin"
    else:
        h["Access-Control-Allow-Origin"] = "*"
    h["Access-Control-Allow-Headers"] = "Content-Type"
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    h["Access-Control-Max-Age"] = "600"
    h["Cache-Control"] = "no-store"
    h["Cross-Origin-Resource-Policy"] = "cross-origin"


def error(message, status, code="error"):
    return jsonify(ok=False, error=code, message=message), status


# --- Sérialisation -----------------------------------------------------------------------------
def poster_url(event):
    return external_url("media.poster", name=event.poster) if event.poster else None


def event_summary(event):
    left = available(event)
    return {
        "id": event.id,
        "slug": event.slug,
        "name": event.name,
        "genre": event.genre,
        "genre_label": event.genre_label,
        "venue": event.venue,
        "city": event.city,
        "starts_at": event.starts_at.isoformat() + "Z",
        "starts_label": fmt_dt(event.starts_at, "%d/%m/%Y à %H:%M"),
        "poster_url": poster_url(event),
        "featured": event.featured,
        "min_price": event.min_price,
        "min_price_label": None if event.min_price is None else
        ("Gratuit" if event.min_price == 0 else money(event.min_price)),
        "currency": current_app.config["CURRENCY"],
        "on_sale": event.on_sale,
        "sold_out": left == 0,
        "organizer": {"name": event.organization.name, "slug": event.organization.slug},
        "url": external_url("shop.event_page", org_slug=event.organization.slug, event_slug=event.slug),
    }


def providers_json():
    return [{"code": p.code, "label": p.label, "description": p.description}
            for p in enabled_providers(current_app.config)]


def _upcoming():
    start_of_day = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (select(Event).join(Organization)
            .where(Event.status == "published", Organization.status == "active", Event.starts_at >= start_of_day))


# --- Lecture -----------------------------------------------------------------------------------
@bp.route("/config")
def config():
    return jsonify(ok=True, platform=current_app.config["PLATFORM_NAME"], currency=current_app.config["CURRENCY"],
                   genres=[{"code": k, "label": v} for k, v in GENRES.items()], providers=providers_json(),
                   max_per_order=current_app.config["MAX_TICKETS_PER_ORDER"],
                   simulation=bool(current_app.config["PAYMENT_SIMULATION"]))


@bp.route("/evenements")
def list_events():
    q = _upcoming()
    text = request.args.get("q", "").strip()[:80]
    if text:
        like = f"%{text}%"
        q = q.where(or_(Event.name.ilike(like), Event.venue.ilike(like), Event.city.ilike(like),
                        Organization.name.ilike(like)))
    genre = request.args.get("genre", "")
    if genre in GENRES:
        q = q.where(Event.genre == genre)
    city = request.args.get("ville", "").strip()[:120]
    if city:
        q = q.where(func.lower(Event.city) == city.lower())
    org = request.args.get("organisateur", "").strip()
    if org:
        q = q.where(Organization.slug == org)
    if request.args.get("a_la_une") == "1":
        q = q.where(Event.featured.is_(True))
    try:
        page = max(1, int(request.args.get("page", 1)))
        size = min(MAX_PAGE_SIZE, max(1, int(request.args.get("par_page", 12))))
    except ValueError:
        page, size = 1, 12
    total = db.session.scalar(select(func.count()).select_from(q.subquery())) or 0
    events = db.session.scalars(q.order_by(Event.starts_at, Event.id).offset((page - 1) * size).limit(size)).all()
    return jsonify(ok=True, total=total, page=page, pages=max(1, -(-total // size)),
                   events=[event_summary(e) for e in events])


@bp.route("/villes")
def cities():
    start_of_day = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    q = (select(Event.city).join(Organization)
         .where(Event.status == "published", Organization.status == "active", Event.starts_at >= start_of_day))
    org = request.args.get("organisateur", "").strip()
    if org:
        q = q.where(Organization.slug == org)
    rows = db.session.scalars(q.distinct()).all()
    return jsonify(ok=True, cities=sorted({c.strip() for c in rows if c and c.strip()}, key=str.lower))


def _find_event(org_slug, event_slug):
    return db.session.scalar(select(Event).join(Organization).where(
        Organization.slug == org_slug, Event.slug == event_slug,
        Event.status.in_(("published", "closed")), Organization.status == "active"))


@bp.route("/evenements/<org_slug>/<event_slug>")
def event_detail(org_slug, event_slug):
    event = _find_event(org_slug, event_slug)
    if not event:
        return error("Événement introuvable.", 404, "not_found")
    data = event_summary(event)
    data["description"] = event.description
    data["categories"] = [{
        "id": c.id, "name": c.name, "price": c.price,
        "price_label": "Gratuit" if c.price == 0 else money(c.price),
        "available": available(event, c),
    } for c in event.categories if c.on_sale]
    data["remaining"] = available(event)
    data["max_per_order"] = current_app.config["MAX_TICKETS_PER_ORDER"]
    data["providers"] = providers_json()
    return jsonify(ok=True, event=data)


# --- Commande ------------------------------------------------------------------------------------
@bp.route("/commandes", methods=["POST", "OPTIONS"], endpoint="create_order")
def create_order_endpoint():
    if request.method == "OPTIONS":
        return "", 204
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error("Requête JSON attendue.", 400, "bad_request")
    try:
        event = db.session.get(Event, int(data.get("event_id") or 0))
    except (TypeError, ValueError):
        event = None
    if not event or event.status != "published" or not event.organization.active:
        return error("Événement introuvable ou fermé à la vente.", 404, "not_found")

    allowed = origins_for(event.organization)
    origin = request.headers.get("Origin")
    if origin and origin not in allowed:
        return error("Ce site n'est pas autorisé à vendre les billets de cet organisateur.", 403, "origin_forbidden")
    return_url = str(data.get("return_url") or "")[:500]
    if return_url and _origin_of(return_url) not in allowed:
        return error("Adresse de retour non autorisée.", 400, "return_url_forbidden")

    customer = data.get("customer") or {}
    customer = {"name": str(customer.get("name", "")).strip()[:160],
                "email": str(customer.get("email", "")).strip().lower()[:190],
                "phone": str(customer.get("phone", "")).strip()[:40]}
    if not customer["name"] or not valid_email(customer["email"]):
        return error("Indiquez votre nom et une adresse e-mail valide.", 400, "invalid_customer")
    if customer["phone"] and not valid_phone(customer["phone"]):
        return error("Numéro de téléphone invalide.", 400, "invalid_customer")
    if not data.get("accept_terms"):
        return error("Les conditions de vente doivent être acceptées.", 400, "terms")

    categories = {c.id: c for c in event.categories}
    quantities = []
    for item in data.get("items") or []:
        try:
            category = categories.get(int(item.get("category_id")))
            qty = int(item.get("quantity", 0))
        except (TypeError, ValueError, AttributeError):
            return error("Panier invalide.", 400, "bad_request")
        if category is None or qty < 0:
            return error("Panier invalide.", 400, "bad_request")
        if qty:
            quantities.append((category, qty))

    if not quantities:
        return error("Choisissez au moins un billet.", 400, "empty_cart")
    is_free = sum(c.price * q for c, q in quantities) == 0
    provider = get_provider(str(data.get("provider") or ""))
    if not is_free and (not provider or not provider.enabled(current_app.config)):
        return error("Choisissez un moyen de paiement.", 400, "provider")
    try:
        order = create_order(event, quantities, customer, provider.code if provider else "free")
    except OrderError as exc:
        db.session.rollback()
        return error(str(exc), 409, "unavailable")
    order.return_url = return_url or None
    key = order_access_key(order)

    if order.amount == 0:
        order, _ = confirm_payment(order.id, source="billet gratuit (site partenaire)")
        db.session.commit()
        send_order_tickets(order)
        db.session.commit()
        return jsonify(ok=True, ref=order.ref, key=key, status="paid", payment_url=None,
                       next_url=return_redirect(order) if order.return_url else order_page_url(order)), 201

    db.session.commit()  # places réservées avant l'appel au prestataire
    try:
        payment_url = provider.start(order)
        db.session.commit()
    except PaymentError as exc:
        db.session.rollback()
        order = db.session.get(Order, order.id)
        mark_failed(order, f"· démarrage : {exc}")
        db.session.commit()
        return error("Le service de paiement est momentanément indisponible. Réessayez.", 502, "payment_unavailable")
    return jsonify(ok=True, ref=order.ref, key=key, status="pending", payment_url=payment_url,
                   amount=order.amount, amount_label=money(order.amount),
                   expires_at=order.expires_at.isoformat() + "Z"), 201


@bp.route("/commandes/<ref>")
def order_status(ref):
    order = db.session.scalar(select(Order).where(Order.ref == ref[:24]))
    if not order or not constant_equals(request.args.get("cle", ""), order_access_key(order)):
        return error("Commande introuvable.", 404, "not_found")
    if (order.status == "pending" and order.created_at < utcnow() - timedelta(seconds=5)
            and not rate_limited("order_verify", order.ref, 6, 1)):
        # Filet de sécurité si la notification du prestataire tarde (6 vérifications/min au plus).
        rate_hit("order_verify", order.ref)
        db.session.commit()
        provider = get_provider(order.provider)
        if provider:
            status, amount, currency, txn = provider.verify(order)
            if status == "paid":
                order, newly = confirm_payment(order.id, amount=amount, currency=currency, txn=txn,
                                               source="vérification (site partenaire)")
                db.session.commit()
                if newly:
                    send_order_tickets(order)
                    db.session.commit()
            elif status == "failed":
                mark_failed(order, "· vérification (site partenaire)")
                db.session.commit()
    key = order_access_key(order)
    tickets = []
    if order.status == "paid":
        for t in sorted(order.tickets, key=lambda t: t.id):
            tickets.append({
                "number": t.ticket_no, "category": t.category.name if t.category else "",
                "holder": t.holder, "status": t.status,
                "qr_url": None if t.status == "cancelled" else
                external_url("shop.order_ticket_qr", ref=order.ref, key=key, ticket_id=t.id),
            })
    return jsonify(
        ok=True, ref=order.ref, status=order.status, amount=order.amount, amount_label=money(order.amount),
        customer_email=order.customer_email,
        event={"name": order.event.name, "starts_label": fmt_dt(order.event.starts_at, "%d/%m/%Y à %H:%M"),
               "venue": order.event.venue, "city": order.event.city, "poster_url": poster_url(order.event)},
        tickets=tickets,
        pdf_url=external_url("shop.order_pdf", ref=order.ref, key=key) if order.status == "paid" else None,
        order_url=order_page_url(order) if order.status == "paid" else None,
    )
