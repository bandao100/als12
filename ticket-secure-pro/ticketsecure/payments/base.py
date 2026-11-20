import hashlib
import hmac
import time

from flask import current_app, url_for


class PaymentError(Exception):
    """Erreur de communication ou réponse inattendue du prestataire."""


class SignatureError(Exception):
    """Notification dont la signature est absente, invalide ou trop ancienne."""


class WebhookResult:
    """Information extraite d'une notification authentifiée."""

    def __init__(self, external_id, status, *, order_ref=None, provider_ref=None,
                 amount=None, currency=None, txn=None):
        self.external_id = external_id
        self.status = status  # paid | failed | ignored
        self.order_ref = order_ref
        self.provider_ref = provider_ref
        self.amount = amount
        self.currency = currency
        self.txn = txn


class Provider:
    code = ""
    label = ""
    description = ""

    def enabled(self, config):
        raise NotImplementedError

    def start(self, order):
        """Crée la session de paiement et retourne l'URL où rediriger le client."""
        raise NotImplementedError

    def verify(self, order):
        """Interroge le prestataire. Retourne (statut, montant, devise, txn)."""
        return "pending", None, None, None


def external_url(endpoint, **values):
    base = current_app.config.get("PUBLIC_BASE_URL")
    if base:
        return base + url_for(endpoint, **values)
    return url_for(endpoint, _external=True, **values)


def http_timeout():
    return current_app.config.get("PAYMENT_HTTP_TIMEOUT", 20)


def parse_signature_header(header):
    """Lit un en-tête de la forme ``t=123,v1=abc,v1=def``."""
    timestamp, signatures = None, []
    for part in (header or "").split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1" and value:
            signatures.append(value)
    return timestamp, signatures


def check_timestamped_hmac(secret, header, signed_payload_fn, tolerance=300):
    """Vérifie une signature HMAC-SHA256 horodatée (schéma Wave et Stripe)."""
    if not secret:
        raise SignatureError("secret de signature non configuré")
    timestamp, signatures = parse_signature_header(header)
    if not timestamp or not signatures:
        raise SignatureError("en-tête de signature absent ou mal formé")
    try:
        ts = int(timestamp)
    except ValueError:
        raise SignatureError("horodatage invalide")
    if abs(time.time() - ts) > tolerance:
        raise SignatureError("notification trop ancienne (rejeu possible)")
    expected = hmac.new(secret.encode("utf-8"), signed_payload_fn(timestamp), hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in signatures):
        raise SignatureError("signature invalide")
