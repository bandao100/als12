"""Wave — API Checkout (https://docs.wave.com/checkout).

1. POST /v1/checkout/sessions → ``wave_launch_url`` où rediriger le client.
2. Webhook ``checkout.session.completed`` signé (en-tête ``Wave-Signature``).
3. Vérification possible à tout moment : GET /v1/checkout/sessions/{id}.
"""
import json

import requests
from flask import current_app

from .base import (PaymentError, Provider, SignatureError, WebhookResult, check_timestamped_hmac,
                   external_url, http_timeout)


class WaveProvider(Provider):
    code = "wave"
    label = "Wave"
    description = "Paiement mobile Wave"

    def enabled(self, config):
        return bool(config.get("WAVE_API_KEY") and config.get("WAVE_WEBHOOK_SECRET"))

    def _headers(self, idempotency_key=None):
        headers = {"Authorization": "Bearer " + current_app.config["WAVE_API_KEY"],
                   "Content-Type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def start(self, order):
        base = current_app.config["WAVE_API_BASE"]
        payload = {
            "amount": str(order.amount),
            "currency": order.currency,
            "client_reference": order.ref,
            "success_url": external_url("shop.payment_return", ref=order.ref),
            "error_url": external_url("shop.payment_return", ref=order.ref, error=1),
        }
        try:
            r = requests.post(base + "/v1/checkout/sessions", json=payload,
                              headers=self._headers(order.ref), timeout=http_timeout())
        except requests.RequestException as exc:
            raise PaymentError(f"Wave injoignable : {exc.__class__.__name__}")
        if r.status_code >= 300:
            raise PaymentError(f"Wave a refusé la session ({r.status_code})")
        data = r.json()
        if not data.get("id") or not data.get("wave_launch_url"):
            raise PaymentError("Réponse Wave incomplète")
        order.provider_ref = data["id"]
        return data["wave_launch_url"]

    def verify(self, order):
        if not order.provider_ref:
            return "pending", None, None, None
        base = current_app.config["WAVE_API_BASE"]
        try:
            r = requests.get(f"{base}/v1/checkout/sessions/{order.provider_ref}",
                             headers=self._headers(), timeout=http_timeout())
        except requests.RequestException:
            return "pending", None, None, None
        if r.status_code != 200:
            return "pending", None, None, None
        data = r.json()
        return self._status(data), _int(data.get("amount")), data.get("currency"), data.get("transaction_id")

    @staticmethod
    def _status(data):
        if data.get("payment_status") == "succeeded":
            return "paid"
        if data.get("checkout_status") == "expired" or data.get("payment_status") == "cancelled":
            return "failed"
        return "pending"

    def parse_webhook(self, req):
        raw = req.get_data()
        check_timestamped_hmac(current_app.config["WAVE_WEBHOOK_SECRET"],
                               req.headers.get("Wave-Signature"),
                               lambda ts: ts.encode("utf-8") + raw)
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        data = event.get("data") or {}
        etype = event.get("type", "")
        if etype == "checkout.session.completed":
            status = self._status(data)
        elif etype == "checkout.session.payment_failed":
            status = "failed"
        else:
            status = "ignored"
        return WebhookResult(event.get("id") or data.get("id", ""), status,
                             order_ref=data.get("client_reference"), provider_ref=data.get("id"),
                             amount=_int(data.get("amount")), currency=data.get("currency"),
                             txn=data.get("transaction_id"))


def _int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None
