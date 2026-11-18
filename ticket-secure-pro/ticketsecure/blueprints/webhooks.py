"""Notifications serveur-à-serveur des prestataires de paiement."""
from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..delivery import send_order_tickets
from ..extensions import db
from ..models import Order, PaymentNotification
from ..orders import confirm_payment, mark_failed
from ..payments import SignatureError, get_provider
from ..security import audit, client_ip

bp = Blueprint("webhooks", __name__, url_prefix="/webhooks")


def _reject(provider_code, reason, status=401):
    audit("webhook_rejected", f"{provider_code} depuis {client_ip()} : {reason}", user=None, actor=provider_code)
    db.session.commit()
    current_app.logger.warning("Notification %s rejetée : %s", provider_code, reason)
    return jsonify(ok=False), status


def _process(provider_code, result, order):
    """Applique une notification authentifiée, une seule fois (idempotence)."""
    if not result.external_id:
        return jsonify(ok=True, ignored=True)
    if db.session.scalar(select(PaymentNotification.id).where(
            PaymentNotification.provider == provider_code,
            PaymentNotification.external_id == result.external_id[:190])):
        return jsonify(ok=True, duplicate=True)
    note = PaymentNotification(provider=provider_code, external_id=result.external_id[:190],
                               order_id=order.id if order else None, outcome=result.status)
    db.session.add(note)
    newly = False
    if order is None:
        note.outcome = "unknown_order"
    elif order.provider != provider_code:
        note.outcome = "provider_mismatch"
    elif result.provider_ref and order.provider_ref and result.provider_ref != order.provider_ref:
        note.outcome = "session_mismatch"
    elif result.status == "paid":
        order, newly = confirm_payment(order.id, amount=result.amount, currency=result.currency,
                                       txn=result.txn, source=f"notification {provider_code}")
        if order.status != "paid":
            note.outcome = "rejected_amount"
    elif result.status == "failed":
        mark_failed(order, f"· notification {provider_code}")
    try:
        db.session.commit()
    except IntegrityError:  # notification identique traitée en parallèle
        db.session.rollback()
        return jsonify(ok=True, duplicate=True)
    if newly:
        send_order_tickets(order)
        db.session.commit()
    return jsonify(ok=True)


def _order_by_ref(ref):
    return db.session.scalar(select(Order).where(Order.ref == ref)) if ref else None


@bp.route("/wave", methods=["POST"])
def wave():
    provider = get_provider("wave")
    if not provider.enabled(current_app.config):
        return jsonify(ok=False), 404
    try:
        result = provider.parse_webhook(request)
    except SignatureError as exc:
        return _reject("wave", str(exc))
    return _process("wave", result, _order_by_ref(result.order_ref))


@bp.route("/stripe", methods=["POST"])
def stripe():
    provider = get_provider("card")
    if not provider.enabled(current_app.config):
        return jsonify(ok=False), 404
    try:
        result = provider.parse_webhook(request)
    except SignatureError as exc:
        return _reject("card", str(exc), 400)
    return _process("card", result, _order_by_ref(result.order_ref))


@bp.route("/orange-money/<ref>", methods=["POST"])
def orange_money(ref):
    provider = get_provider("orange_money")
    if not provider.enabled(current_app.config):
        return jsonify(ok=False), 404
    order = _order_by_ref(ref)
    if order is None or order.provider != "orange_money":
        return _reject("orange_money", f"commande inconnue {ref[:30]}", 404)
    data = request.get_json(silent=True) or request.form.to_dict()
    try:
        result = provider.check_notification(order, data)
    except SignatureError as exc:
        return _reject("orange_money", f"{ref[:30]} : {exc}")
    if result.status == "paid":
        # Double contrôle : confirmation directe auprès de l'API Orange.
        status, amount, currency, txn = provider.verify(order)
        if status != "paid":
            audit("webhook_unconfirmed", f"orange_money {order.ref} : statut API « {status} »",
                  user=None, organization_id=order.organization_id, actor="orange_money")
            db.session.commit()
            return jsonify(ok=False, retry=True), 409
        result.amount, result.currency, result.txn = amount, currency, txn or result.txn
    return _process("orange_money", result, order)
