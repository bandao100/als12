"""Orange Money — API « Web Payment » (developer.orange.com).

1. Jeton OAuth2 (client_credentials) sur /oauth/v3/token.
2. POST /orange-money-webpay/{pays}/v1/webpayment → ``payment_url``,
   ``pay_token`` et ``notif_token``.
3. Orange appelle ``notif_url`` avec {status, notif_token, txnid}. Le
   ``notif_token`` est comparé à celui reçu à l'étape 2 (stocké haché), puis le
   statut est confirmé par l'API /transactionstatus avant toute émission.

Le pays « dev » correspond au bac à sable (devise « OUV »).
"""
import base64
import time

import requests
from flask import current_app

from ..security import constant_equals, sha256_hex
from .base import PaymentError, Provider, SignatureError, WebhookResult, external_url, http_timeout

_token_cache = {"value": None, "expires": 0}


class OrangeMoneyProvider(Provider):
    code = "orange_money"
    label = "Orange Money"
    description = "Paiement mobile Orange Money"

    def enabled(self, config):
        return bool(config.get("ORANGE_CLIENT_ID") and config.get("ORANGE_CLIENT_SECRET")
                    and config.get("ORANGE_MERCHANT_KEY"))

    def _currency(self, order):
        cfg = current_app.config
        if cfg["ORANGE_CURRENCY"]:
            return cfg["ORANGE_CURRENCY"]
        return "OUV" if cfg["ORANGE_COUNTRY"] == "dev" else order.currency

    def _url(self, path):
        cfg = current_app.config
        return f"{cfg['ORANGE_API_BASE']}/orange-money-webpay/{cfg['ORANGE_COUNTRY']}/v1/{path}"

    def _access_token(self):
        if _token_cache["value"] and _token_cache["expires"] > time.time() + 60:
            return _token_cache["value"]
        cfg = current_app.config
        basic = base64.b64encode(f"{cfg['ORANGE_CLIENT_ID']}:{cfg['ORANGE_CLIENT_SECRET']}".encode()).decode()
        try:
            r = requests.post(cfg["ORANGE_API_BASE"] + "/oauth/v3/token",
                              headers={"Authorization": "Basic " + basic, "Accept": "application/json"},
                              data={"grant_type": "client_credentials"}, timeout=http_timeout())
        except requests.RequestException as exc:
            raise PaymentError(f"Orange injoignable : {exc.__class__.__name__}")
        if r.status_code != 200:
            raise PaymentError(f"Authentification Orange refusée ({r.status_code})")
        data = r.json()
        _token_cache["value"] = data["access_token"]
        _token_cache["expires"] = time.time() + int(data.get("expires_in", 3000))
        return _token_cache["value"]

    def _headers(self):
        return {"Authorization": "Bearer " + self._access_token(),
                "Accept": "application/json", "Content-Type": "application/json"}

    def start(self, order):
        payload = {
            "merchant_key": current_app.config["ORANGE_MERCHANT_KEY"],
            "currency": self._currency(order),
            "order_id": order.ref,
            "amount": order.amount,
            "return_url": external_url("shop.payment_return", ref=order.ref),
            "cancel_url": external_url("shop.payment_return", ref=order.ref, error=1),
            "notif_url": external_url("webhooks.orange_money", ref=order.ref),
            "lang": "fr",
            "reference": current_app.config["PLATFORM_NAME"][:30],
        }
        try:
            r = requests.post(self._url("webpayment"), json=payload, headers=self._headers(),
                              timeout=http_timeout())
        except requests.RequestException as exc:
            raise PaymentError(f"Orange injoignable : {exc.__class__.__name__}")
        if r.status_code not in (200, 201):
            raise PaymentError(f"Orange a refusé le paiement ({r.status_code})")
        data = r.json()
        if not data.get("payment_url") or not data.get("pay_token") or not data.get("notif_token"):
            raise PaymentError("Réponse Orange incomplète")
        order.pay_token = data["pay_token"]
        order.provider_ref = data["pay_token"]
        order.provider_secret_hash = sha256_hex(data["notif_token"])
        return data["payment_url"]

    def verify(self, order):
        if not order.pay_token:
            return "pending", None, None, None
        payload = {"order_id": order.ref, "amount": order.amount, "pay_token": order.pay_token}
        try:
            r = requests.post(self._url("transactionstatus"), json=payload, headers=self._headers(),
                              timeout=http_timeout())
        except (requests.RequestException, PaymentError):
            return "pending", None, None, None
        if r.status_code not in (200, 201):
            return "pending", None, None, None
        data = r.json()
        status = (data.get("status") or "").upper()
        if status == "SUCCESS":
            # L'API confirme la transaction pour le montant demandé à l'étape 2.
            return "paid", order.amount, order.currency, data.get("txnid")
        if status in ("FAILED", "EXPIRED"):
            return "failed", None, None, None
        return "pending", None, None, None

    def check_notification(self, order, data):
        """Authentifie une notification Orange pour ``order``."""
        if not order.provider_secret_hash or not constant_equals(
                sha256_hex(str(data.get("notif_token", ""))), order.provider_secret_hash):
            raise SignatureError("notif_token invalide")
        txn = str(data.get("txnid") or "")
        status = (data.get("status") or "").upper()
        return WebhookResult(f"{order.ref}:{txn or status}",
                             "paid" if status == "SUCCESS" else "failed" if status == "FAILED" else "ignored",
                             order_ref=order.ref, txn=txn)
