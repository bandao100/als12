"""Émission des billets et validation à usage unique.

Jeton QR
--------
Le QR contient ``TSP3.<code>`` où ``code`` = HMAC-SHA256(TICKET_SECRET, sel).
La base ne stocke que le sel et SHA-256(jeton) : une fuite de la base seule ne
permet ni de reconstituer ni de fabriquer un billet, mais le serveur peut
réafficher le QR (page client, réimpression) sans l'avoir conservé en clair.

Usage unique
------------
La validation verrouille la ligne du billet (``SELECT ... FOR UPDATE`` sur
PostgreSQL) : deux contrôleurs simultanés ne peuvent pas valider le même billet.
"""
import base64
import hashlib
import hmac
import secrets
from datetime import datetime

from flask import current_app
from sqlalchemy import func, select

from .extensions import db
from .models import (CONTROLLER, Event, EventAssignment, OrderItem, Order, ScanLog, Ticket,
                     TicketCategory, utcnow)
from .security import audit, sha256_hex

TOKEN_PREFIX = "TSP3."
MAX_TOKEN_LEN = 200


def derive_token(salt):
    key = current_app.config["TICKET_SECRET"].encode("utf-8")
    mac = hmac.new(key, salt.encode("ascii"), hashlib.sha256).digest()
    return TOKEN_PREFIX + base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def ticket_token(ticket):
    return derive_token(ticket.token_salt)


def token_digest(token):
    return sha256_hex(token)


def manifest_key(token_hash):
    """Empreinte tronquée (128 bits) transmise aux appareils hors connexion."""
    return token_hash[:32]


def lock_event(event_id):
    return db.session.scalar(select(Event).where(Event.id == event_id).with_for_update())


def issued_count(event_id, category_id=None):
    q = select(func.count(Ticket.id)).where(Ticket.event_id == event_id, Ticket.status != "cancelled")
    if category_id is not None:
        q = q.where(Ticket.category_id == category_id)
    return db.session.scalar(q) or 0


def reserved_count(event_id, category_id=None, exclude_order_id=None):
    """Places retenues par des commandes en attente de paiement non expirées."""
    q = (select(func.coalesce(func.sum(OrderItem.quantity), 0))
         .join(Order, Order.id == OrderItem.order_id)
         .where(Order.event_id == event_id, Order.status == "pending", Order.expires_at > utcnow()))
    if category_id is not None:
        q = q.where(OrderItem.category_id == category_id)
    if exclude_order_id is not None:
        q = q.where(Order.id != exclude_order_id)
    return db.session.scalar(q) or 0


def available(event, category=None, exclude_order_id=None):
    """Places encore disponibles (None = illimité). À appeler sous verrou de l'événement."""
    limits = []
    if event.capacity:
        limits.append(event.capacity - issued_count(event.id)
                      - reserved_count(event.id, exclude_order_id=exclude_order_id))
    if category is not None and category.quota:
        limits.append(category.quota - issued_count(event.id, category.id)
                      - reserved_count(event.id, category.id, exclude_order_id=exclude_order_id))
    return max(0, min(limits)) if limits else None


def issue_tickets(event, quantity, *, category=None, order=None, holder="", source="manual"):
    """Crée ``quantity`` billets. L'appelant doit détenir le verrou de l'événement."""
    total = db.session.scalar(select(func.count(Ticket.id)).where(Ticket.event_id == event.id)) or 0
    tickets = []
    for n in range(quantity):
        salt = secrets.token_hex(16)
        ticket = Ticket(
            organization_id=event.organization_id, event_id=event.id,
            category_id=category.id if category else None,
            order_id=order.id if order else None,
            ticket_no=f"TS{event.id:04d}-{total + n + 1:06d}",
            holder=(holder or "")[:160], source=source,
            token_salt=salt, token_hash=token_digest(derive_token(salt)),
        )
        db.session.add(ticket)
        tickets.append(ticket)
    db.session.flush()
    return tickets


# --- Validation -------------------------------------------------------------------
MESSAGES = {
    "accepted": "ENTRÉE AUTORISÉE",
    "duplicate": "DÉJÀ UTILISÉ — ACCÈS REFUSÉ",
    "invalid": "BILLET INCONNU — ACCÈS REFUSÉ",
    "cancelled": "BILLET ANNULÉ — ACCÈS REFUSÉ",
    "wrong_event": "MAUVAIS ÉVÉNEMENT OU MAUVAISE PORTE",
    "event_closed": "ÉVÉNEMENT ANNULÉ — ACCÈS REFUSÉ",
    "conflict": "CONFLIT : BILLET DÉJÀ UTILISÉ SUR UN AUTRE APPAREIL",
}


def scannable_scope(user):
    """Événements (et catégorie éventuelle) que l'utilisateur peut contrôler.

    Retourne None si l'utilisateur peut contrôler tous les événements de son
    organisation, sinon un dict {event_id: category_id_ou_None}.
    """
    if user.can("scan.any_event"):
        return None
    rows = db.session.scalars(select(EventAssignment).where(EventAssignment.user_id == user.id)).all()
    return {a.event_id: a.category_id for a in rows}


def scannable_events(user):
    scope = scannable_scope(user)
    q = select(Event).where(Event.organization_id == user.organization_id,
                            Event.status.in_(("published", "closed")))
    if scope is not None:
        q = q.where(Event.id.in_(list(scope) or [-1]))
    return db.session.scalars(q.order_by(Event.starts_at)).all()


def _in_scope(user, ticket, scope):
    if ticket.organization_id != user.organization_id:
        return False
    if scope is None:
        return True
    if ticket.event_id not in scope:
        return False
    restricted = scope[ticket.event_id]
    return restricted is None or restricted == ticket.category_id


def validate_token(token, user, *, device=None, event_id=None, offline=False,
                   client_scan_id=None, scanned_at=None, local_result=None):
    """Valide un jeton et journalise le contrôle. Retourne un dict de réponse.

    ``offline=True`` : contrôle effectué hors connexion puis synchronisé ;
    ``local_result`` est la décision prise sur l'appareil.
    L'appelant doit faire ``db.session.commit()``.
    """
    token = (token or "").strip()
    now = utcnow()
    scanned_at = scanned_at or now
    if scanned_at > now:
        scanned_at = now  # une horloge d'appareil en avance ne doit pas fausser l'historique

    ticket = None
    if token and len(token) <= MAX_TOKEN_LEN:
        ticket = db.session.scalar(
            select(Ticket).where(Ticket.token_hash == token_digest(token)).with_for_update())
    scope = scannable_scope(user)

    if ticket is None or ticket.organization_id != user.organization_id:
        result, ticket = "invalid", None
    elif not _in_scope(user, ticket, scope) or (event_id and ticket.event_id != int(event_id)):
        result = "wrong_event"
    elif ticket.event.status == "cancelled":
        result = "event_closed"
    elif ticket.status == "cancelled":
        result = "cancelled"
    elif ticket.status == "used":
        result = "conflict" if (offline and local_result == "accepted") else "duplicate"
    else:
        result = "accepted"
        ticket.status = "used"
        ticket.used_at = scanned_at
        ticket.used_by = user.id
        ticket.used_device_id = device.id if device else None

    detail = MESSAGES[result]
    if offline:
        detail = "Hors connexion · " + detail
    log = ScanLog(
        organization_id=user.organization_id,
        event_id=ticket.event_id if ticket else (int(event_id) if event_id else None),
        ticket_id=ticket.id if ticket else None,
        scanner_id=user.id, device_id=device.id if device else None,
        client_scan_id=client_scan_id, offline=offline,
        scanned_at=scanned_at, received_at=now, result=result, detail=detail[:240],
    )
    db.session.add(log)
    if result == "conflict":
        audit("offline_conflict",
              f"Billet {ticket.ticket_no} admis hors connexion par l'appareil "
              f"{device.name if device else '?'} alors qu'il était déjà utilisé "
              f"le {ticket.used_at:%d/%m/%Y %H:%M:%S} UTC", user=user)

    response = {"ok": result == "accepted", "status": result, "message": MESSAGES[result]}
    if ticket is not None:
        response.update(ticket=ticket.ticket_no, event=ticket.event.name,
                        category=ticket.category.name if ticket.category else "",
                        used_at=ticket.used_at.isoformat() + "Z" if ticket.used_at else None)
    return response


def parse_client_time(value):
    """Lit une date ISO 8601 envoyée par un appareil et la convertit en UTC naïf."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        from datetime import timezone
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def category_for_event(event, category_id):
    if not category_id:
        return None
    category = db.session.get(TicketCategory, int(category_id))
    if not category or category.event_id != event.id:
        return None
    return category


def is_controller(user):
    return user.role == CONTROLLER
