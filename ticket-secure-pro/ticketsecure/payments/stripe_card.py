"""Cartes bancaires (Visa, Mastercard) via Stripe Checkout.

Appels HTTP directs (sans SDK) :
1. POST /v1/checkout/sessions → ``url`` de la page de paiement hébergée.
2. Webhook ``checkout.session.completed`` signé (en-tête ``Stripe-Signature``).
3. Vérification : GET /v1/checkout/sessions/{id}.

Le franc CFA (XOF) est une devise « sans décimale » chez Stripe : le montant est
transmis tel quel. Vérifiez l'éligibilité de votre pays d'établissement auprès de
Stripe ; un autre agrégateur de cartes peut être ajouté sur le même modèle.
"""
import json
from datetime import timedelta, timezone

import requests
from flask import current_app

from ..models import utcnow
from .base import (PaymentError, Provider, SignatureError, WebhookResult, check_timestamped_hmac,
                   external_url, http_timeout)

ZERO_DECIMAL = {"XOF", "XAF", "GNF", "JPY", "KRW", "RWF", "UGX", "VND"}


class StripeCardProvider(Provider):
    code = "card"
    label = "Carte bancaire"
    description = "Visa, Mastercard"

    def enabled(self, config):
        return bool(config.get("STRIPE_SECRET_KEY") and config.get("STRIPE_WEBHOOK_SECRET"))

    def _auth(self):
        return {"Authorization": "Bearer " + current_app.config["STRIPE_SECRET_KEY"]}

    @staticmethod
    def _minor(amount, currency):
        return amount if currency.upper() in ZERO_DECIMAL else amount * 100

    def start(self, order):
        currency = order.currency.lower()
        data = {
            "mode": "payment",
            "client_reference_id": order.ref,
            "customer_email": order.customer_email,
            "metadata[order_ref]": order.ref,
            "success_url": external_url("shop.payment_return", ref=order.ref),
            "cancel_url": external_url("shop.payment_return", ref=order.ref, error=1),
            # Stripe impose au moins 30 minutes.
            "expires_at": int(max(order.expires_at, utcnow() + timedelta(minutes=31))
                              .replace(tzinfo=timezone.utc).timestamp()),
        }
        for i, item in enumerate(order.items):
            data[f"line_items[{i}][quantity]"] = item.quantity
            data[f"line_items[{i}][price_data][currency]"] = currency
            data[f"line_items[{i}][price_data][unit_amount]"] = self._minor(item.unit_price, order.currency)
            data[f"line_items[{i}][price_data][product_data][name]"] = \
                f"{order.event.name} — {item.category.name}"[:250]
        headers = dict(self._auth(), **{"Idempotency-Key": "checkout-" + order.ref})
        try:
            r = requests.post(current_app.config["STRIPE_API_BASE"] + "/v1/checkout/sessions",
                              data=data, headers=headers, timeout=http_timeout())
        except requests.RequestException as exc:
            raise PaymentError(f"Stripe injoignable : {exc.__class__.__name__}")
        if r.status_code >= 300:
            raise PaymentError(f"Stripe a refusé la session ({r.status_code})")
        body = r.json()
        if not body.get("id") or not body.get("url"):
            raise PaymentError("Réponse Stripe incomplète")
        order.provider_ref = body["id"]
        return body["url"]

    def _from_session(self, session):
        currency = (session.get("currency") or "").upper()
        amount = session.get("amount_total")
        if amount is not None and currency and currency not in ZERO_DECIMAL:
            amount = amount // 100
        if session.get("payment_status") in ("paid", "no_payment_required") and session.get("status") == "complete":
            status = "paid"
        elif session.get("status") == "expired":
            status = "failed"
        else:
            status = "pending"
        return status, amount, currency, session.get("payment_intent")

    def verify(self, order):
        if not order.provider_ref:
            return "pending", None, None, None
        try:
            r = requests.get(f"{current_app.config['STRIPE_API_BASE']}/v1/checkout/sessions/{order.provider_ref}",
                             headers=self._auth(), timeout=http_timeout())
        except requests.RequestException:
            return "pending", None, None, None
        if r.status_code != 200:
            return "pending", None, None, None
        return self._from_session(r.json())

    def parse_webhook(self, req):
        raw = req.get_data()
        check_timestamped_hmac(current_app.config["STRIPE_WEBHOOK_SECRET"],
                               req.headers.get("Stripe-Signature"),
                               lambda ts: ts.encode("utf-8") + b"." + raw)
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        session = (event.get("data") or {}).get("object") or {}
        etype = event.get("type", "")
        if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded",
                     "checkout.session.async_payment_failed", "checkout.session.expired"):
            status, amount, currency, txn = self._from_session(session)
            if etype == "checkout.session.async_payment_failed":
                status = "failed"
        else:
            status, amount, currency, txn = "ignored", None, None, None
        if status == "pending":
            status = "ignored"
        return WebhookResult(event.get("id", ""), status,
                             order_ref=session.get("client_reference_id"), provider_ref=session.get("id"),
                             amount=amount, currency=currency, txn=txn)
