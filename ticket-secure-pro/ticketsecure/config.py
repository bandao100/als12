"""Configuration lue depuis les variables d'environnement.

En production (APP_ENV=production), l'application refuse de démarrer si un
secret obligatoire manque ou si un réglage dangereux est actif.
"""
import os
from datetime import timedelta


def _bool(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on", "oui")


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return int(default)


DEV_SECRET = "dev-only-change-this-secret-key-0000000000000000"


def build_config(overrides=None):
    env = os.environ
    app_env = env.get("APP_ENV", "development").strip().lower()
    production = app_env == "production"
    db_url = env.get("DATABASE_URL", "sqlite:///ticket_secure.db")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    secret = env.get("SECRET_KEY", DEV_SECRET)

    cfg = dict(
        APP_ENV=app_env,
        PRODUCTION=production,
        SECRET_KEY=secret,
        # Secret distinct servant à dériver les jetons QR (voir tickets.py).
        TICKET_SECRET=env.get("TICKET_SECRET") or ("ticket:" + secret),
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        PUBLIC_BASE_URL=env.get("PUBLIC_BASE_URL", "").rstrip("/"),
        TRUST_PROXY=_bool("TRUST_PROXY", "1" if production else "0"),
        SESSION_COOKIE_NAME="tsp_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=_bool("COOKIE_SECURE", "1" if production else "0"),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=_int("SESSION_HOURS", 10)),
        PREFERRED_URL_SCHEME="https" if production else "http",
        MAX_CONTENT_LENGTH=4 * 1024 * 1024,
        WTF_CSRF_TIME_LIMIT=None,  # le jeton CSRF vit autant que la session
        APP_TIMEZONE=env.get("APP_TIMEZONE", "Africa/Ouagadougou"),
        CURRENCY=env.get("CURRENCY", "XOF"),
        PLATFORM_NAME=env.get("PLATFORM_NAME", "Ticket Secure Pro"),
        PLATFORM_FEE_PERCENT=float(env.get("PLATFORM_FEE_PERCENT", "5")),
        ORDER_HOLD_MINUTES=_int("ORDER_HOLD_MINUTES", 30),
        MAX_TICKETS_PER_ORDER=_int("MAX_TICKETS_PER_ORDER", 10),
        # Paiements
        PAYMENT_SIMULATION=_bool("PAYMENT_SIMULATION", "0" if production else "1"),
        WAVE_API_KEY=env.get("WAVE_API_KEY", ""),
        WAVE_WEBHOOK_SECRET=env.get("WAVE_WEBHOOK_SECRET", ""),
        WAVE_API_BASE=env.get("WAVE_API_BASE", "https://api.wave.com"),
        ORANGE_CLIENT_ID=env.get("ORANGE_CLIENT_ID", ""),
        ORANGE_CLIENT_SECRET=env.get("ORANGE_CLIENT_SECRET", ""),
        ORANGE_MERCHANT_KEY=env.get("ORANGE_MERCHANT_KEY", ""),
        ORANGE_COUNTRY=env.get("ORANGE_COUNTRY", "dev"),
        ORANGE_CURRENCY=env.get("ORANGE_CURRENCY", ""),
        ORANGE_API_BASE=env.get("ORANGE_API_BASE", "https://api.orange.com"),
        STRIPE_SECRET_KEY=env.get("STRIPE_SECRET_KEY", ""),
        STRIPE_WEBHOOK_SECRET=env.get("STRIPE_WEBHOOK_SECRET", ""),
        STRIPE_API_BASE=env.get("STRIPE_API_BASE", "https://api.stripe.com"),
        PAYMENT_HTTP_TIMEOUT=_int("PAYMENT_HTTP_TIMEOUT", 20),
        # E-mail
        MAIL_SERVER=env.get("MAIL_SERVER", ""),
        MAIL_PORT=_int("MAIL_PORT", 587),
        MAIL_USERNAME=env.get("MAIL_USERNAME", ""),
        MAIL_PASSWORD=env.get("MAIL_PASSWORD", ""),
        MAIL_USE_SSL=_bool("MAIL_USE_SSL", "0"),
        MAIL_USE_TLS=_bool("MAIL_USE_TLS", "1"),
        MAIL_FROM=env.get("MAIL_FROM", "billets@example.com"),
        # Appareils / hors connexion
        CORS_ORIGINS=[o.strip() for o in env.get(
            "CORS_ORIGINS", "https://appassets.androidplatform.net").split(",") if o.strip()],
        DEVICE_TOKEN_DAYS=_int("DEVICE_TOKEN_DAYS", 30),
        # Limitation de débit
        LOGIN_MAX_FAILURES=_int("LOGIN_MAX_FAILURES", 5),
        LOGIN_WINDOW_MINUTES=_int("LOGIN_WINDOW_MINUTES", 15),
        ORDERS_PER_IP_PER_HOUR=_int("ORDERS_PER_IP_PER_HOUR", 20),
    )
    if overrides:
        cfg.update(overrides)
    if cfg["PRODUCTION"]:
        _check_production(cfg)
    return cfg


def _check_production(cfg):
    problems = []
    if cfg["SECRET_KEY"] == DEV_SECRET or len(cfg["SECRET_KEY"]) < 32:
        problems.append("SECRET_KEY absent ou trop court (32 caractères minimum)")
    if not os.environ.get("TICKET_SECRET") or len(os.environ["TICKET_SECRET"]) < 32:
        problems.append("TICKET_SECRET absent ou trop court (32 caractères minimum)")
    if not cfg["SQLALCHEMY_DATABASE_URI"].startswith("postgresql"):
        problems.append("DATABASE_URL doit pointer vers PostgreSQL")
    if not cfg["SESSION_COOKIE_SECURE"]:
        problems.append("COOKIE_SECURE doit valoir 1 (HTTPS obligatoire)")
    if cfg["PAYMENT_SIMULATION"]:
        problems.append("PAYMENT_SIMULATION doit valoir 0 en production")
    if not cfg["PUBLIC_BASE_URL"].startswith("https://"):
        problems.append("PUBLIC_BASE_URL doit commencer par https://")
    if problems:
        raise RuntimeError("Configuration de production invalide : " + " ; ".join(problems))
