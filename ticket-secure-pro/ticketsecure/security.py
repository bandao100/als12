"""Authentification, permissions, limitation de débit et journal d'audit."""
import hashlib
import hmac
import secrets
from datetime import timedelta
from functools import wraps

from flask import abort, current_app, has_request_context, redirect, request, session, url_for
from sqlalchemy import func, select, text

from .extensions import db
from .models import PLATFORM_ADMIN, AuditLog, Organization, RateLimitHit, User, utcnow


def sha256_hex(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def constant_equals(a, b):
    return hmac.compare_digest(str(a or ""), str(b or ""))


def client_ip():
    return (request.remote_addr or "")[:64] if request else ""


# --- Mots de passe -------------------------------------------------------------
MIN_PASSWORD = 12


def password_problem(password, email=""):
    if len(password) < MIN_PASSWORD:
        return f"Le mot de passe doit contenir au moins {MIN_PASSWORD} caractères."
    if len(password) > 256:
        return "Mot de passe trop long."
    if email and email.split("@")[0].lower() in password.lower() and len(email.split("@")[0]) >= 4:
        return "Le mot de passe ne doit pas contenir votre adresse e-mail."
    if len(set(password)) < 6:
        return "Le mot de passe est trop répétitif."
    return None


# --- Session ------------------------------------------------------------------
def login_user(user):
    session.clear()
    session.permanent = True
    session["uid"] = user.id
    session["sv"] = user.session_version
    user.last_login_at = utcnow()


def current_user():
    if not has_request_context():
        return None
    cached = getattr(request, "_tsp_user", False)
    if cached is not False:
        return cached
    user = None
    uid = session.get("uid")
    if uid:
        candidate = db.session.get(User, uid)
        if candidate and candidate.active and candidate.session_version == session.get("sv"):
            if candidate.role == PLATFORM_ADMIN or (candidate.organization and candidate.organization.active):
                user = candidate
        if user is None:
            session.clear()
    request._tsp_user = user
    return user


def login_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return redirect(url_for("auth.login", next=request.full_path if request.method == "GET" else None))
        if user.must_change_password and request.endpoint not in ("auth.change_password", "auth.logout"):
            return redirect(url_for("auth.change_password"))
        return fn(*args, **kwargs)
    return wrapped


def permission_required(*permissions):
    """Exige au moins une des permissions et une organisation active."""
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapped(*args, **kwargs):
            user = current_user()
            if user.role == PLATFORM_ADMIN or not any(user.can(p) for p in permissions):
                abort(403)
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def platform_required(fn):
    @wraps(fn)
    @login_required
    def wrapped(*args, **kwargs):
        if current_user().role != PLATFORM_ADMIN:
            abort(403)
        return fn(*args, **kwargs)
    return wrapped


def org_scoped(query_model, object_id):
    """Charge un objet appartenant à l'organisation de l'utilisateur, sinon 404."""
    user = current_user()
    obj = db.session.get(query_model, object_id)
    if not obj or obj.organization_id != user.organization_id:
        abort(404)
    return obj


# --- Limitation de débit (stockée en base : partagée entre les workers) ---------
def rate_limited(bucket, key, limit, minutes):
    since = utcnow() - timedelta(minutes=minutes)
    count = db.session.scalar(
        select(func.count(RateLimitHit.id)).where(
            RateLimitHit.bucket == bucket, RateLimitHit.key == key[:200], RateLimitHit.created_at >= since)
    ) or 0
    return count >= limit


def rate_hit(bucket, key):
    db.session.add(RateLimitHit(bucket=bucket, key=key[:200]))


def purge_rate_limits(older_than_hours=48):
    limit = utcnow() - timedelta(hours=older_than_hours)
    db.session.execute(RateLimitHit.__table__.delete().where(RateLimitHit.created_at < limit))


def login_blocked(email):
    cfg = current_app.config
    window = cfg["LOGIN_WINDOW_MINUTES"]
    return (rate_limited("login_email", email, cfg["LOGIN_MAX_FAILURES"], window)
            or rate_limited("login_ip", client_ip(), cfg["LOGIN_MAX_FAILURES"] * 4, window))


def record_login_failure(email):
    rate_hit("login_email", email)
    rate_hit("login_ip", client_ip())


def authenticate(email, password):
    """Retourne (user, message_erreur). Limite les tentatives par e-mail et IP."""
    email = (email or "").strip().lower()
    if login_blocked(email):
        audit("login_blocked", email, actor=email)
        db.session.commit()
        return None, "Trop de tentatives. Réessayez dans quelques minutes."
    user = db.session.scalar(select(User).where(User.email == email))
    from werkzeug.security import check_password_hash
    ok = bool(user and user.active and check_password_hash(user.password_hash, password or ""))
    if not ok:
        if not user:
            # Temps de réponse comparable que l'e-mail existe ou non.
            check_password_hash(DUMMY_HASH, password or "")
        record_login_failure(email)
        audit("login_failed", email, actor=email, user=user)
        db.session.commit()
        return None, "Identifiants incorrects."
    if user.role != PLATFORM_ADMIN:
        org = db.session.get(Organization, user.organization_id) if user.organization_id else None
        if not org or not org.active:
            audit("login_refused_suspended", email, user=user)
            db.session.commit()
            return None, "Organisation suspendue. Contactez l'assistance."
    return user, None


from werkzeug.security import generate_password_hash  # noqa: E402

DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(16))


# --- Audit chaîné ------------------------------------------------------------------
def _audit_digest(prev_hash, entry):
    payload = "|".join([
        prev_hash,
        str(entry.organization_id or ""),
        str(entry.user_id or ""),
        entry.actor or "",
        entry.action,
        entry.detail or "",
        entry.ip or "",
        entry.created_at.replace(microsecond=0).isoformat(),
    ])
    return sha256_hex(payload)


_UNSET = object()


def audit(action, detail="", *, user=_UNSET, organization_id=None, actor=None):
    """Ajoute une entrée au journal. ``user=None`` : action sans utilisateur connecté."""
    if user is _UNSET:
        try:
            user = current_user()
        except RuntimeError:
            user = None
    if organization_id is None and user is not None:
        organization_id = user.organization_id
    if db.engine.dialect.name == "postgresql":
        # Sérialise l'écriture de la chaîne jusqu'au COMMIT.
        db.session.execute(text("SELECT pg_advisory_xact_lock(7342001)"))
    prev = db.session.scalar(select(AuditLog.entry_hash).order_by(AuditLog.id.desc()).limit(1)) or ""
    try:
        ip = client_ip()
    except RuntimeError:
        ip = ""
    entry = AuditLog(
        organization_id=organization_id,
        user_id=user.id if user else None,
        actor=(actor or (user.email if user else "système"))[:190],
        action=action[:80],
        detail=(detail or "")[:500],
        ip=ip,
        created_at=utcnow().replace(microsecond=0),
        prev_hash=prev,
    )
    entry.entry_hash = _audit_digest(prev, entry)
    db.session.add(entry)
    db.session.flush()
    return entry


def verify_audit_chain():
    """Retourne (ok, nombre_entrées, id_première_anomalie)."""
    prev = ""
    count = 0
    for entry in db.session.scalars(select(AuditLog).order_by(AuditLog.id)).yield_per(500):
        count += 1
        if entry.prev_hash != prev or entry.entry_hash != _audit_digest(prev, entry):
            return False, count, entry.id
        prev = entry.entry_hash
    return True, count, None
