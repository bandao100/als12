"""Billetterie publique : pages d'événements, commande, paiement, remise des billets."""
from flask import (Blueprint, abort, current_app, flash, redirect, render_template, request, send_file,
                   session, url_for)
from sqlalchemy import select

from ..delivery import order_access_key, qr_png, send_order_tickets, tickets_pdf
from ..extensions import db
from ..models import Event, Order, Organization, Ticket, utcnow
from ..orders import OrderError, confirm_payment, create_order, mark_failed
from ..payments import PaymentError, enabled_providers, get_provider
from ..security import audit, constant_equals
from ..tickets import available, ticket_token
from ..utils import valid_email, valid_phone

bp = Blueprint("shop", __name__)


def _published_events(org_id=None):
    q = (select(Event).join(Organization)
         .where(Event.status == "published", Organization.status == "active",
                Event.starts_at >= utcnow().replace(hour=0, minute=0, second=0)))
    if org_id:
        q = q.where(Event.organization_id == org_id)
    return db.session.scalars(q.order_by(Event.starts_at).limit(100)).all()


@bp.route("/")
def home():
    return render_template("shop/home.html", events=_published_events())


@bp.route("/o/<org_slug>")
def organization(org_slug):
    org = db.session.scalar(select(Organization).where(Organization.slug == org_slug))
    if not org or not org.active:
        abort(404)
    return render_template("shop/organization.html", organization=org, events=_published_events(org.id))


def _public_event(org_slug, event_slug):
    event = db.session.scalar(select(Event).join(Organization).where(
        Organization.slug == org_slug, Event.slug == event_slug))
    if not event or event.status not in ("published", "closed") or not event.organization.active:
        abort(404)
    return event


@bp.route("/o/<org_slug>/<event_slug>")
def event_page(org_slug, event_slug):
    event = _public_event(org_slug, event_slug)
    categories = [(c, available(event, c)) for c in event.categories if c.on_sale]
    return render_template("shop/event.html", event=event, categories=categories,
                           providers=enabled_providers(current_app.config), remaining=available(event),
                           max_qty=current_app.config["MAX_TICKETS_PER_ORDER"], form={})


@bp.route("/o/<org_slug>/<event_slug>/commander", methods=["POST"])
def checkout(org_slug, event_slug):
    event = _public_event(org_slug, event_slug)
    form = request.form
    customer = {"name": form.get("name", "").strip()[:160],
                "email": form.get("email", "").strip().lower(),
                "phone": form.get("phone", "").strip()[:40]}
    provider = get_provider(form.get("provider", ""))
    quantities = []
    for category in event.categories:
        try:
            qty = int(form.get(f"qty_{category.id}", "0") or 0)
        except ValueError:
            qty = 0
        if qty > 0:
            quantities.append((category, qty))

    def fail(message):
        db.session.rollback()
        flash(message, "error")
        categories = [(c, available(event, c)) for c in event.categories if c.on_sale]
        return render_template("shop/event.html", event=event, categories=categories,
                               providers=enabled_providers(current_app.config), remaining=available(event),
                               max_qty=current_app.config["MAX_TICKETS_PER_ORDER"], form=form), 400

    if not customer["name"] or not valid_email(customer["email"]):
        return fail("Indiquez votre nom et une adresse e-mail valide : vos billets y seront envoyés.")
    if customer["phone"] and not valid_phone(customer["phone"]):
        return fail("Numéro de téléphone invalide.")
    if form.get("accept") != "1":
        return fail("Vous devez accepter les conditions de vente.")
    is_free = sum(c.price * q for c, q in quantities) == 0
    if not is_free and (not provider or not provider.enabled(current_app.config)):
        return fail("Choisissez un moyen de paiement.")
    try:
        order = create_order(event, quantities, customer, provider.code if provider else "free")
    except OrderError as exc:
        return fail(str(exc))

    session.setdefault("my_orders", [])
    session["my_orders"] = (session["my_orders"] + [order.ref])[-10:]

    if order.amount == 0:
        order, _ = confirm_payment(order.id, source="billet gratuit")
        db.session.commit()
        send_order_tickets(order)
        db.session.commit()
        return redirect(url_for("shop.order_page", ref=order.ref, key=order_access_key(order)))

    db.session.commit()  # la réservation est acquise avant l'appel au prestataire
    try:
        target = provider.start(order)
        db.session.commit()
    except PaymentError as exc:
        db.session.rollback()
        order = db.session.get(Order, order.id)
        mark_failed(order, f"· démarrage : {exc}")
        db.session.commit()
        current_app.logger.warning("Paiement %s non démarré : %s", order.ref, exc)
        flash("Le service de paiement est momentanément indisponible. Réessayez ou choisissez un autre moyen.",
              "error")
        return redirect(url_for("shop.event_page", org_slug=org_slug, event_slug=event_slug))
    return redirect(target, code=303)


@bp.route("/paiement/retour/<ref>")
def payment_return(ref):
    """Retour du client. N'est jamais une preuve de paiement : on interroge le prestataire."""
    order = db.session.scalar(select(Order).where(Order.ref == ref))
    if not order:
        abort(404)
    if order.status == "pending":
        provider = get_provider(order.provider)
        if provider:
            status, amount, currency, txn = provider.verify(order)
            if status == "paid":
                order, newly = confirm_payment(order.id, amount=amount, currency=currency, txn=txn,
                                               source="vérification au retour du client")
                db.session.commit()
                if newly:
                    send_order_tickets(order)
                    db.session.commit()
            elif status == "failed":
                mark_failed(order, "· retour client")
                db.session.commit()
    mine = ref in session.get("my_orders", [])
    if order.status == "paid" and mine:
        return redirect(url_for("shop.order_page", ref=order.ref, key=order_access_key(order)))
    return render_template("shop/payment_status.html", order=order, mine=mine,
                           cancelled=bool(request.args.get("error")))


def _order_with_key(ref, key):
    order = db.session.scalar(select(Order).where(Order.ref == ref))
    if not order or not constant_equals(key, order_access_key(order)):
        abort(404)
    return order


@bp.route("/commande/<ref>/<key>")
def order_page(ref, key):
    order = _order_with_key(ref, key)
    tickets = sorted(order.tickets, key=lambda t: t.id)
    return render_template("shop/order.html", order=order, tickets=tickets, key=key)


@bp.route("/commande/<ref>/<key>/billet/<int:ticket_id>.png")
def order_ticket_qr(ref, key, ticket_id):
    order = _order_with_key(ref, key)
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket or ticket.order_id != order.id or ticket.status == "cancelled":
        abort(404)
    return send_file(qr_png(ticket_token(ticket)), mimetype="image/png", max_age=0)


@bp.route("/commande/<ref>/<key>/billets.pdf")
def order_pdf(ref, key):
    order = _order_with_key(ref, key)
    tickets = [t for t in sorted(order.tickets, key=lambda t: t.id) if t.status != "cancelled"]
    if not tickets:
        abort(404)
    import io
    return send_file(io.BytesIO(tickets_pdf(tickets, current_app.config["PLATFORM_NAME"])),
                     mimetype="application/pdf", as_attachment=True, download_name=f"billets-{order.ref}.pdf")


@bp.route("/paiement/simulation/<ref>", methods=["GET", "POST"])
def simulated_payment(ref):
    provider = get_provider("simulation")
    if not provider.enabled(current_app.config):
        abort(404)
    order = db.session.scalar(select(Order).where(Order.ref == ref, Order.provider == "simulation"))
    if not order:
        abort(404)
    if request.method == "POST":
        if request.form.get("decision") == "pay":
            order, newly = confirm_payment(order.id, amount=order.amount, currency=order.currency,
                                           txn="SIM-" + order.ref, source="simulation")
            db.session.commit()
            if newly:
                send_order_tickets(order)
                db.session.commit()
        else:
            mark_failed(order, "· simulation refusée")
            audit("order_cancelled_by_customer", order.ref, user=None, organization_id=order.organization_id,
                  actor=order.customer_email)
            db.session.commit()
        return redirect(url_for("shop.payment_return", ref=order.ref))
    return render_template("shop/simulation.html", order=order)


@bp.route("/conditions")
def terms():
    return render_template("shop/terms.html")
