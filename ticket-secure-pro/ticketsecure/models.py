"""Modèle de données (PostgreSQL en production, SQLite accepté pour les essais).

Toutes les dates sont stockées en UTC, sans fuseau (``utcnow``), et converties
dans le fuseau de la plateforme uniquement à l'affichage.
"""
import secrets
from datetime import datetime, timezone

from .extensions import db


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Rôles -------------------------------------------------------------------
PLATFORM_ADMIN = "platform_admin"
ADMIN = "admin"
SUPERVISOR = "supervisor"
CONTROLLER = "controller"

ORG_ROLES = (ADMIN, SUPERVISOR, CONTROLLER)
ROLE_LABELS = {
    PLATFORM_ADMIN: "Super administrateur",
    ADMIN: "Administrateur",
    SUPERVISOR: "Superviseur",
    CONTROLLER: "Contrôleur",
}

# Permissions accordées à chaque rôle d'organisation.
PERMISSIONS = {
    ADMIN: {
        "events.manage", "tickets.generate", "tickets.cancel", "sales.view", "orders.manage",
        "team.view", "team.manage_admins", "team.manage_supervisors", "team.manage_controllers",
        "devices.manage", "scan.any_event", "scan", "audit.view", "settings.manage",
    },
    SUPERVISOR: {
        "events.manage", "tickets.generate", "tickets.cancel", "sales.view", "orders.manage",
        "team.view", "team.manage_controllers", "devices.manage", "scan.any_event", "scan",
        "audit.view",
    },
    CONTROLLER: {"scan"},
    PLATFORM_ADMIN: {"platform"},
}


class Organization(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    slug = db.Column(db.String(80), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="active")  # active | suspended
    plan = db.Column(db.String(30), nullable=False, default="starter")
    contact_email = db.Column(db.String(190), default="")
    contact_phone = db.Column(db.String(40), default="")
    fee_percent = db.Column(db.Numeric(5, 2), nullable=True)  # None = taux plateforme
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    @property
    def active(self):
        return self.status == "active"


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=True, index=True)
    email = db.Column(db.String(190), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(140), nullable=False)
    phone = db.Column(db.String(40), default="")
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(30), nullable=False, default=CONTROLLER)
    active = db.Column(db.Boolean, nullable=False, default=True)
    must_change_password = db.Column(db.Boolean, nullable=False, default=False)
    # Incrémenté à chaque changement de mot de passe : invalide les sessions
    # et les liens de réinitialisation précédents.
    session_version = db.Column(db.Integer, nullable=False, default=1)
    last_login_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    organization = db.relationship("Organization", backref="users")

    def can(self, permission):
        return permission in PERMISSIONS.get(self.role, set())

    @property
    def role_label(self):
        return ROLE_LABELS.get(self.role, self.role)


class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=False, index=True)
    name = db.Column(db.String(180), nullable=False)
    slug = db.Column(db.String(120), nullable=False)
    venue = db.Column(db.String(180), default="")
    city = db.Column(db.String(120), default="")
    description = db.Column(db.Text, default="")
    starts_at = db.Column(db.DateTime, nullable=False)
    capacity = db.Column(db.Integer, nullable=False, default=0)  # 0 = illimitée
    # draft : brouillon ; published : visible et en vente ; closed : ventes closes ; cancelled
    status = db.Column(db.String(20), nullable=False, default="draft")
    online_sales = db.Column(db.Boolean, nullable=False, default=True)
    offline_scan_allowed = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    organization = db.relationship("Organization", backref="events")
    categories = db.relationship("TicketCategory", backref="event", order_by="TicketCategory.id")

    __table_args__ = (db.UniqueConstraint("organization_id", "slug", name="uq_event_org_slug"),)

    @property
    def on_sale(self):
        return self.status == "published" and self.online_sales and self.organization.active


class TicketCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    price = db.Column(db.Integer, nullable=False, default=0)  # en unités entières (XOF)
    quota = db.Column(db.Integer, nullable=False, default=0)  # 0 = selon la capacité de l'événement
    on_sale = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class EventAssignment(db.Model):
    """Affecte un membre (contrôleur ou superviseur) à un événement.

    ``category_id`` restreint éventuellement le contrôleur à une catégorie
    (porte VIP, porte standard...). C'est ce cloisonnement qui permet de
    garantir l'usage unique en mode hors connexion : un billet n'est présent
    que dans le manifeste des appareils de sa porte.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False, index=True)
    category_id = db.Column(db.Integer, db.ForeignKey("ticket_category.id"), nullable=True)
    gate = db.Column(db.String(60), default="")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    user = db.relationship("User", backref="assignments")
    event = db.relationship("Event", backref="assignments")
    category = db.relationship("TicketCategory")

    __table_args__ = (db.UniqueConstraint("user_id", "event_id", name="uq_assignment_user_event"),)


class Order(db.Model):
    __tablename__ = "customer_order"

    id = db.Column(db.Integer, primary_key=True)
    ref = db.Column(db.String(24), unique=True, nullable=False, index=True,
                    default=lambda: "C" + secrets.token_hex(6).upper())
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=False, index=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False, index=True)
    customer_name = db.Column(db.String(160), nullable=False)
    customer_email = db.Column(db.String(190), nullable=False)
    customer_phone = db.Column(db.String(40), default="")
    # pending | paid | failed | cancelled | expired | refunded
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    provider = db.Column(db.String(30), nullable=False)
    provider_ref = db.Column(db.String(190), index=True)  # id de session chez le prestataire
    provider_txn = db.Column(db.String(190))  # identifiant de transaction final
    provider_secret_hash = db.Column(db.String(64))  # ex. notif_token Orange Money (haché)
    pay_token = db.Column(db.String(190))  # Orange Money : nécessaire à la vérification
    amount = db.Column(db.Integer, nullable=False)
    fee_amount = db.Column(db.Integer, nullable=False, default=0)
    currency = db.Column(db.String(8), nullable=False, default="XOF")
    client_ip = db.Column(db.String(64), default="")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    paid_at = db.Column(db.DateTime)
    tickets_sent_at = db.Column(db.DateTime)

    event = db.relationship("Event")
    organization = db.relationship("Organization")
    items = db.relationship("OrderItem", backref="order", cascade="all, delete-orphan")

    @property
    def quantity(self):
        return sum(i.quantity for i in self.items)


class OrderItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("customer_order.id"), nullable=False, index=True)
    category_id = db.Column(db.Integer, db.ForeignKey("ticket_category.id"), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price = db.Column(db.Integer, nullable=False)

    category = db.relationship("TicketCategory")


class Ticket(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=False, index=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False, index=True)
    category_id = db.Column(db.Integer, db.ForeignKey("ticket_category.id"), nullable=True, index=True)
    order_id = db.Column(db.Integer, db.ForeignKey("customer_order.id"), nullable=True, index=True)
    ticket_no = db.Column(db.String(60), unique=True, nullable=False)
    holder = db.Column(db.String(160), default="")
    source = db.Column(db.String(20), nullable=False, default="manual")  # manual | online
    # Le jeton du QR n'est jamais stocké : seul son sel et son empreinte SHA-256 le sont.
    token_salt = db.Column(db.String(64), unique=True, nullable=False)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="valid")  # valid | used | cancelled
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False, index=True)
    used_at = db.Column(db.DateTime)
    used_by = db.Column(db.Integer, db.ForeignKey("user.id"))
    used_device_id = db.Column(db.Integer, db.ForeignKey("device.id"))

    event = db.relationship("Event")
    category = db.relationship("TicketCategory")
    order = db.relationship("Order", backref="tickets")


class Device(db.Model):
    """Téléphone de contrôle enregistré (application Android ou PWA)."""
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    last_seen_at = db.Column(db.DateTime)
    last_sync_at = db.Column(db.DateTime)
    revoked_at = db.Column(db.DateTime)

    user = db.relationship("User", backref="devices")

    @property
    def usable(self):
        return self.revoked_at is None and self.expires_at > utcnow()


class ScanLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=True, index=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=True, index=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=True, index=True)
    scanner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    device_id = db.Column(db.Integer, db.ForeignKey("device.id"), nullable=True, index=True)
    client_scan_id = db.Column(db.String(64), nullable=True)
    offline = db.Column(db.Boolean, nullable=False, default=False)
    scanned_at = db.Column(db.DateTime, default=utcnow, nullable=False)  # heure de l'appareil si hors ligne
    received_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    # accepted | duplicate | invalid | cancelled | wrong_event | conflict
    result = db.Column(db.String(30), nullable=False)
    detail = db.Column(db.String(240), default="")

    ticket = db.relationship("Ticket")
    scanner = db.relationship("User")
    device = db.relationship("Device")

    __table_args__ = (db.UniqueConstraint("device_id", "client_scan_id", name="uq_scan_device_client_id"),)


class PaymentNotification(db.Model):
    """Journal des notifications reçues des prestataires (idempotence + traçabilité)."""
    id = db.Column(db.Integer, primary_key=True)
    provider = db.Column(db.String(30), nullable=False)
    external_id = db.Column(db.String(190), nullable=False)
    order_id = db.Column(db.Integer, db.ForeignKey("customer_order.id"), nullable=True, index=True)
    outcome = db.Column(db.String(40), nullable=False)
    received_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("provider", "external_id", name="uq_payment_notification"),)


class EmailOutbox(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=True, index=True)
    order_id = db.Column(db.Integer, db.ForeignKey("customer_order.id"), nullable=True, index=True)
    to_email = db.Column(db.String(190), nullable=False)
    subject = db.Column(db.String(200), nullable=False)
    kind = db.Column(db.String(40), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending | sent | failed | not_configured
    attempts = db.Column(db.Integer, nullable=False, default=0)
    last_error = db.Column(db.String(300), default="")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    sent_at = db.Column(db.DateTime)


class RateLimitHit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bucket = db.Column(db.String(40), nullable=False)
    key = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    __table_args__ = (db.Index("ix_ratelimit_bucket_key_time", "bucket", "key", "created_at"),)


class AuditLog(db.Model):
    """Journal d'audit en ajout seul, chaîné par empreintes SHA-256.

    Chaque entrée contient l'empreinte de la précédente : toute modification ou
    suppression ultérieure en base est détectée par ``audit.verify_chain``.
    """
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organization.id"), nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    actor = db.Column(db.String(190), default="")
    action = db.Column(db.String(80), nullable=False, index=True)
    detail = db.Column(db.String(500), default="")
    ip = db.Column(db.String(64), default="")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    prev_hash = db.Column(db.String(64), nullable=False, default="")
    entry_hash = db.Column(db.String(64), nullable=False, default="")
