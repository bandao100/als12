"""API des appareils de contrôle (application Android et scanner hors connexion).

Authentification : ``Authorization: Bearer <jeton d'appareil>``. Le jeton est
remis une seule fois à l'enregistrement ; la base n'en garde que l'empreinte.

Protocole hors connexion
------------------------
1. L'appareil télécharge le manifeste d'un événement : empreintes tronquées des
   jetons (jamais les jetons eux-mêmes), numéros et statuts des billets qu'il a
   le droit de contrôler.
2. Sans réseau, il valide localement : empreinte connue et statut « valide »,
   puis marque le billet utilisé sur l'appareil et met le contrôle en file.
3. Dès que le réseau revient, il envoie la file (``/synchroniser``) : chaque
   contrôle porte un identifiant unique, le renvoi est donc sans effet (idempotent).
   Le serveur rejoue les entrées sous verrou ; un billet admis hors connexion
   alors qu'il avait déjà servi ailleurs est marqué « conflit » et signalé.
4. L'appareil récupère les changements (``?depuis=``) pour connaître les billets
   utilisés sur les autres appareils.

Le cloisonnement par catégorie/porte (affectations) garantit qu'un billet n'est
contrôlable hors connexion que par un seul groupe d'appareils.
"""
import secrets
from datetime import timedelta
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import select

from ..extensions import db
from ..models import Device, Event, ScanLog, Ticket, User, utcnow
from ..security import audit, authenticate, sha256_hex
from ..tickets import (MESSAGES, manifest_key, parse_client_time, scannable_events, scannable_scope,
                       token_digest, validate_token)

bp = Blueprint("api", __name__, url_prefix="/api/v1")

MAX_SYNC_BATCH = 500
LOCAL_REFUSALS = {"duplicate", "invalid", "cancelled", "wrong_event", "event_closed"}


def error(message, status, code="error"):
    return jsonify(ok=False, error=code, message=message), status


def device_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return error("Authentification requise.", 401, "unauthorized")
        device = db.session.scalar(select(Device).where(Device.token_hash == sha256_hex(header[7:].strip())))
        if not device or not device.usable:
            return error("Appareil révoqué ou expiré. Reconnectez-vous.", 401, "device_revoked")
        user = device.user
        if not user.active or not user.can("scan") or not user.organization or not user.organization.active:
            return error("Compte désactivé ou organisation suspendue.", 401, "device_revoked")
        device.last_seen_at = utcnow()
        g.device, g.user = device, user
        return fn(*args, **kwargs)
    return wrapped


def _event_json(event, scope):
    category_id = scope.get(event.id) if scope is not None else None
    return {
        "id": event.id, "name": event.name, "venue": event.venue, "city": event.city,
        "starts_at": event.starts_at.isoformat() + "Z", "status": event.status,
        "offline_allowed": event.offline_scan_allowed,
        "category_restriction": next((c.name for c in event.categories if c.id == category_id), None),
    }


@bp.route("/appareils", methods=["POST"])
def register_device():
    data = request.get_json(silent=True) or {}
    user, message = authenticate(data.get("email"), data.get("password"))
    if message:
        return error(message, 401, "login_failed")
    if not user.can("scan"):
        return error("Ce compte n'a pas accès au contrôle des billets.", 403, "forbidden")
    if user.must_change_password:
        return error("Changez d'abord votre mot de passe provisoire sur le site web.", 403, "password_change")
    token = secrets.token_urlsafe(32)
    device = Device(organization_id=user.organization_id, user_id=user.id,
                    name=(str(data.get("device_name") or "Appareil")).strip()[:120] or "Appareil",
                    token_hash=sha256_hex(token),
                    expires_at=utcnow() + timedelta(days=current_app.config["DEVICE_TOKEN_DAYS"]))
    db.session.add(device)
    db.session.flush()
    audit("device_registered", f"{device.name} (#{device.id})", user=user)
    db.session.commit()
    return jsonify(ok=True, token=token, device_id=device.id, expires_at=device.expires_at.isoformat() + "Z",
                   user={"name": user.full_name, "email": user.email, "role": user.role_label},
                   organization=user.organization.name), 201


@bp.route("/moi")
@device_required
def me():
    db.session.commit()
    return jsonify(ok=True, device={"id": g.device.id, "name": g.device.name},
                   user={"name": g.user.full_name, "email": g.user.email, "role": g.user.role_label},
                   organization=g.user.organization.name, server_time=utcnow().isoformat() + "Z")


@bp.route("/evenements")
@device_required
def events():
    scope = scannable_scope(g.user)
    rows = [_event_json(e, scope) for e in scannable_events(g.user)]
    db.session.commit()
    return jsonify(ok=True, events=rows)


@bp.route("/evenements/<int:event_id>/manifeste")
@device_required
def manifest(event_id):
    user = g.user
    event = db.session.get(Event, event_id)
    scope = scannable_scope(user)
    if (not event or event.organization_id != user.organization_id
            or (scope is not None and event.id not in scope)):
        return error("Événement non autorisé pour ce compte.", 404, "not_found")
    if not event.offline_scan_allowed:
        return error("Le mode hors connexion est désactivé pour cet événement.", 403, "offline_disabled")
    server_time = utcnow()
    since = parse_client_time(request.args.get("depuis"))
    q = select(Ticket).where(Ticket.event_id == event.id)
    if scope is not None and scope.get(event.id):
        q = q.where(Ticket.category_id == scope[event.id])
    if since:
        # Marge de sécurité : une modification en cours de transaction n'est pas perdue.
        q = q.where(Ticket.updated_at >= since - timedelta(seconds=30))
    tickets = db.session.scalars(q.order_by(Ticket.id)).all()
    categories = {c.id: c.name for c in event.categories}
    g.device.last_sync_at = server_time
    db.session.commit()
    return jsonify(
        ok=True, event=_event_json(event, scope), full=since is None,
        server_time=server_time.isoformat() + "Z",
        # [empreinte tronquée, numéro, statut, catégorie] — aucun nom de titulaire.
        tickets=[[manifest_key(t.token_hash), t.ticket_no, t.status, categories.get(t.category_id, "")]
                 for t in tickets],
    )


@bp.route("/valider", methods=["POST"])
@device_required
def validate():
    data = request.get_json(silent=True) or {}
    try:
        event_id = int(data.get("event_id") or 0) or None
    except (TypeError, ValueError):
        event_id = None
    try:
        response = validate_token(str(data.get("token", ""))[:300], g.user, device=g.device, event_id=event_id)
        db.session.commit()
    except Exception:  # noqa: BLE001
        db.session.rollback()
        current_app.logger.exception("Erreur de validation API")
        return error("ERREUR TECHNIQUE — RÉESSAYEZ", 500)
    return jsonify(response)


@bp.route("/synchroniser", methods=["POST"])
@device_required
def sync():
    data = request.get_json(silent=True) or {}
    scans = data.get("scans") or []
    if not isinstance(scans, list) or len(scans) > MAX_SYNC_BATCH:
        return error(f"Lot invalide ({MAX_SYNC_BATCH} contrôles maximum).", 400, "bad_request")
    device, user = g.device, g.user
    device_id = device.id
    user_id = user.id
    entries = []
    for raw in scans:
        if not isinstance(raw, dict):
            continue
        scan_id = str(raw.get("id") or "")[:64]
        if not scan_id:
            continue
        entries.append((parse_client_time(raw.get("scanned_at")) or utcnow(), scan_id, raw))
    entries.sort(key=lambda e: e[0])  # rejoue dans l'ordre chronologique de l'appareil

    results = []
    for scanned_at, scan_id, raw in entries:
        # Chaque contrôle est une transaction courte : pas de verrous croisés entre appareils.
        device = db.session.get(Device, device_id)
        user = db.session.get(User, user_id)
        existing = db.session.scalar(select(ScanLog).where(ScanLog.device_id == device_id,
                                                           ScanLog.client_scan_id == scan_id))
        if existing:
            results.append({"id": scan_id, "status": existing.result, "duplicate_upload": True})
            continue
        local = str(raw.get("local_result") or "")
        token = str(raw.get("token") or "")[:300]
        try:
            event_id = int(raw.get("event_id") or 0) or None
        except (TypeError, ValueError):
            event_id = None
        try:
            if local == "accepted":
                response = validate_token(token, user, device=device, event_id=event_id, offline=True,
                                          client_scan_id=scan_id, scanned_at=scanned_at, local_result=local)
                status = response["status"]
            else:
                # Refus prononcé sur place : on le journalise sans toucher au billet.
                status = local if local in LOCAL_REFUSALS else "invalid"
                ticket = db.session.scalar(select(Ticket).where(Ticket.token_hash == token_digest(token))) \
                    if token else None
                if ticket and ticket.organization_id != user.organization_id:
                    ticket = None
                db.session.add(ScanLog(
                    organization_id=user.organization_id, event_id=ticket.event_id if ticket else event_id,
                    ticket_id=ticket.id if ticket else None, scanner_id=user.id, device_id=device.id,
                    client_scan_id=scan_id, offline=True, scanned_at=min(scanned_at, utcnow()),
                    result=status, detail=("Hors connexion · " + MESSAGES.get(status, ""))[:240]))
            db.session.commit()
            results.append({"id": scan_id, "status": status})
        except Exception:  # noqa: BLE001
            db.session.rollback()
            current_app.logger.exception("Erreur de synchronisation")
            results.append({"id": scan_id, "status": "retry"})
    device = db.session.get(Device, device_id)
    device.last_sync_at = utcnow()
    db.session.commit()
    return jsonify(ok=True, results=results, server_time=utcnow().isoformat() + "Z")


@bp.route("/deconnexion", methods=["POST"])
@device_required
def logout_device():
    g.device.revoked_at = utcnow()
    audit("device_logout", g.device.name, user=g.user)
    db.session.commit()
    return jsonify(ok=True)
