"""Commandes de la billetterie en ligne : réservation, confirmation, émission."""
from datetime import timedelta
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from flask import current_app
from sqlalchemy import select

from .extensions import db
from .models import Order, OrderItem, utcnow
from .security import audit, client_ip, rate_hit, rate_limited
from .tickets import available, issue_tickets, lock_event


class OrderError(Exception):
    pass


def fee_for(order):
    org = order.organization
    pct = Decimal(str(org.fee_percent if org.fee_percent is not None
                      else current_app.config["PLATFORM_FEE_PERCENT"]))
    return int((Decimal(order.amount) * pct / 100).to_integral_value())


def create_order(event, quantities, customer, provider_code):
    """Réserve les places et crée une commande en attente de paiement.

    ``quantities`` : liste de (catégorie, quantité). Lève OrderError.
    """
    cfg = current_app.config
    total_qty = sum(q for _, q in quantities)
    if total_qty < 1:
        raise OrderError("Choisissez au moins un billet.")
    if total_qty > cfg["MAX_TICKETS_PER_ORDER"]:
        raise OrderError(f"{cfg['MAX_TICKETS_PER_ORDER']} billets maximum par commande.")
    ip = client_ip()
    if rate_limited("order_ip", ip, cfg["ORDERS_PER_IP_PER_HOUR"], 60):
        raise OrderError("Trop de commandes depuis cette connexion. Réessayez plus tard.")

    locked = lock_event(event.id)  # sérialise les réservations sur cet événement
    if not locked or not locked.on_sale:
        raise OrderError("Les ventes en ligne sont fermées pour cet événement.")
    amount = 0
    for category, qty in quantities:
        if category.event_id != locked.id or not category.on_sale:
            raise OrderError("Catégorie indisponible.")
        left = available(locked, category)
        if left is not None and qty > left:
            raise OrderError(f"Plus que {left} place(s) disponible(s) en « {category.name} ».")
        amount += category.price * qty
    left_event = available(locked)
    if left_event is not None and total_qty > left_event:
        raise OrderError(f"Plus que {left_event} place(s) disponible(s).")

    order = Order(
        organization_id=locked.organization_id, event_id=locked.id,
        customer_name=customer["name"], customer_email=customer["email"],
        customer_phone=customer.get("phone", ""),
        provider="free" if amount == 0 else provider_code,
        amount=amount, currency=cfg["CURRENCY"], client_ip=ip,
        expires_at=utcnow() + timedelta(minutes=cfg["ORDER_HOLD_MINUTES"]),
    )
    for category, qty in quantities:
        if qty:
            order.items.append(OrderItem(category_id=category.id, quantity=qty, unit_price=category.price))
    db.session.add(order)
    rate_hit("order_ip", ip)
    db.session.flush()
    audit("order_created", f"{order.ref} · {total_qty} billet(s) · {amount} {order.currency} · {order.provider}",
          user=None, organization_id=order.organization_id, actor=customer["email"])
    return order


def confirm_payment(order_id, *, amount=None, currency=None, txn=None, source=""):
    """Passe une commande à « payée » et émet les billets, une seule fois.

    Retourne (order, newly_paid). L'appelant fait le COMMIT puis envoie l'e-mail.
    """
    order = db.session.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        return None, False
    if order.status == "paid":
        return order, False
    if order.status == "refunded":
        return order, False
    if amount is not None and int(amount) != order.amount:
        audit("payment_amount_mismatch", f"{order.ref} : reçu {amount}, attendu {order.amount} ({source})",
              user=None, organization_id=order.organization_id, actor=order.provider)
        return order, False
    if currency and currency.upper() not in (order.currency.upper(), "OUV"):
        audit("payment_currency_mismatch", f"{order.ref} : devise {currency} ({source})",
              user=None, organization_id=order.organization_id, actor=order.provider)
        return order, False

    event = lock_event(order.event_id)
    late = order.status != "pending" or order.expires_at < utcnow()
    for item in order.items:
        issue_tickets(event, item.quantity, category=item.category, order=order,
                      holder=order.customer_name, source="online")
    order.status = "paid"
    order.paid_at = utcnow()
    order.provider_txn = (txn or "")[:190] or order.provider_txn
    order.fee_amount = fee_for(order)
    audit("order_paid", f"{order.ref} · {order.amount} {order.currency} · {order.provider} · {source}"
          + (" · paiement tardif (après expiration de la réservation)" if late else ""),
          user=None, organization_id=order.organization_id, actor=order.provider)
    return order, True


def mark_failed(order, reason=""):
    if order.status == "pending":
        order.status = "failed"
        audit("order_failed", f"{order.ref} {reason}"[:500], user=None,
              organization_id=order.organization_id, actor=order.provider)


def expire_pending_orders():
    rows = db.session.scalars(select(Order).where(Order.status == "pending",
                                                  Order.expires_at < utcnow() - timedelta(minutes=5))).all()
    for order in rows:
        order.status = "expired"
    return len(rows)


def return_redirect(order, cancelled=False):
    """Page du site partenaire où renvoyer le client après le paiement (``?tsp_commande=REF``).

    ``order.return_url`` a été validé à la création de la commande (origine autorisée).
    ``cancelled`` : le client a abandonné ou l'opérateur a signalé une erreur (``tsp_annule=1``).
    """
    parts = urlsplit(order.return_url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k not in ("tsp_commande", "tsp_annule")]
    query.append(("tsp_commande", order.ref))
    if cancelled:
        query.append(("tsp_annule", "1"))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
