"""Paiement simulé, pour les démonstrations et les tests uniquement.

Interdit en production (voir config._check_production).
"""
from flask import url_for

from .base import Provider


class SimulationProvider(Provider):
    code = "simulation"
    label = "Paiement simulé (test)"
    description = "Aucun argent n'est débité"

    def enabled(self, config):
        return bool(config.get("PAYMENT_SIMULATION")) and not config.get("PRODUCTION")

    def start(self, order):
        order.provider_ref = "SIM-" + order.ref
        return url_for("shop.simulated_payment", ref=order.ref)
