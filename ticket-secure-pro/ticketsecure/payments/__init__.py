"""Prestataires de paiement en ligne.

Principe de sécurité commun : le retour du client sur le site (« success_url »)
n'est JAMAIS une preuve de paiement. Une commande ne passe à « payée » qu'après
une notification signée du prestataire (webhook) ou une vérification directe
serveur-à-serveur auprès de son API, avec contrôle du montant et de la devise.
"""
from .base import PaymentError, SignatureError  # noqa: F401
from .orange_money import OrangeMoneyProvider
from .simulation import SimulationProvider
from .stripe_card import StripeCardProvider
from .wave import WaveProvider

PROVIDERS = {
    p.code: p for p in (WaveProvider(), OrangeMoneyProvider(), StripeCardProvider(), SimulationProvider())
}


def get_provider(code):
    return PROVIDERS.get(code)


def enabled_providers(config):
    return [p for p in PROVIDERS.values() if p.enabled(config)]
