"""Ticket Secure Pro V3 — billetterie multi-organisateurs et contrôle d'accès."""
import os

import click
from flask import Flask, jsonify, render_template, request
from flask_wtf.csrf import CSRFError, generate_csrf
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import build_config
from .extensions import csrf, db, migrate

__version__ = "3.1.0"


def create_app(overrides=None):
    app = Flask(__name__)
    app.config.update(build_config(overrides))
    if app.config["TRUST_PROXY"]:
        # Derrière Caddy/Nginx : lit X-Forwarded-For / -Proto (un seul proxy de confiance).
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db.init_app(app)
    csrf.init_app(app)
    migrate.init_app(app, db, directory=os.path.join(os.path.dirname(__file__), "..", "migrations"),
                     render_as_batch=True)

    from . import media
    from .blueprints import admin, api, auth, platform, public_api, shop, team, webhooks
    for bp in (auth.bp, admin.bp, team.bp, platform.bp, shop.bp, webhooks.bp, api.bp, public_api.bp, media.bp):
        app.register_blueprint(bp)
    csrf.exempt(webhooks.bp)    # authentifiés par signature du prestataire
    csrf.exempt(api.bp)         # authentifiés par jeton d'appareil (pas de cookie)
    csrf.exempt(public_api.bp)  # sans cookie : origine contrôlée (CORS) et données publiques

    @app.route("/health")
    def health():
        try:
            db.session.execute(db.text("SELECT 1"))
            return jsonify(status="ok", version=__version__)
        except Exception:  # noqa: BLE001
            return jsonify(status="error"), 503

    _register_template_helpers(app)
    _register_security_headers(app)
    _register_errors(app)
    _register_cli(app)
    return app


def _register_template_helpers(app):
    from .models import ROLE_LABELS
    from .security import current_user
    from .utils import fmt_dt, money

    app.jinja_env.filters["dt"] = fmt_dt
    app.jinja_env.filters["money"] = money

    @app.context_processor
    def inject():
        return dict(csrf_token=generate_csrf, current_user=current_user(),
                    platform_name=app.config["PLATFORM_NAME"], role_labels=ROLE_LABELS,
                    simulation=app.config["PAYMENT_SIMULATION"], version=__version__)


CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; "
       "connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; "
       "base-uri 'self'; frame-ancestors 'none'")


def _register_security_headers(app):
    from .blueprints import public_api

    @app.after_request
    def headers(response):
        h = response.headers
        h.setdefault("Content-Security-Policy", CSP)
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        if app.config["SESSION_COOKIE_SECURE"]:
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.blueprint in ("admin", "team", "platform", "auth", "api") or request.path.startswith("/commande"):
            h["Cache-Control"] = "no-store"
        if request.blueprint == "public_api":
            public_api.add_cors_headers(response)
            return response
        # CORS limité à l'API des appareils (application Android).
        origin = request.headers.get("Origin")
        if request.blueprint == "api" and origin and origin in app.config["CORS_ORIGINS"]:
            h["Access-Control-Allow-Origin"] = origin
            h["Vary"] = "Origin"
            h["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            h["Access-Control-Max-Age"] = "600"
        return response


def _register_errors(app):
    def wants_json():
        return request.blueprint in ("api", "webhooks", "public_api") or request.path.startswith("/api/")

    def page(code, title, message):
        if wants_json():
            return jsonify(ok=False, error=title, message=message), code
        return render_template("error.html", code=code, title=title, message=message), code

    @app.errorhandler(CSRFError)
    def csrf_error(_e):
        return page(400, "Formulaire expiré", "La page a expiré. Rechargez-la et recommencez.")

    @app.errorhandler(403)
    def forbidden(_e):
        return page(403, "Accès refusé", "Votre rôle ne permet pas d'accéder à cette page.")

    @app.errorhandler(404)
    def not_found(_e):
        return page(404, "Page introuvable", "Cette page n'existe pas ou n'est plus disponible.")

    @app.errorhandler(405)
    def not_allowed(_e):
        return page(405, "Méthode non autorisée", "Action non autorisée.")

    @app.errorhandler(413)
    def too_large(_e):
        return page(413, "Envoi trop volumineux", "Les données envoyées sont trop volumineuses.")

    @app.errorhandler(500)
    def server_error(_e):
        db.session.rollback()
        return page(500, "Erreur technique", "Une erreur est survenue. Réessayez dans un instant.")


def _register_cli(app):
    from werkzeug.security import generate_password_hash

    from .models import PLATFORM_ADMIN, User

    @app.cli.command("create-platform-admin")
    @click.option("--email", prompt=True)
    @click.option("--name", default="Super administrateur")
    @click.password_option()
    def create_platform_admin(email, name, password):
        """Crée un super administrateur de la plateforme."""
        from .security import password_problem
        problem = password_problem(password, email)
        if problem or len(password) < 16:
            raise click.ClickException(problem or "16 caractères minimum pour un super administrateur.")
        email = email.strip().lower()
        if db.session.scalar(db.select(User).where(User.email == email)):
            raise click.ClickException("Cette adresse existe déjà.")
        db.session.add(User(email=email, full_name=name, role=PLATFORM_ADMIN,
                            password_hash=generate_password_hash(password)))
        db.session.commit()
        click.echo("Super administrateur créé.")

    @app.cli.command("maintenance")
    def maintenance():
        """Expire les commandes abandonnées et purge les compteurs de limitation."""
        from .orders import expire_pending_orders
        from .security import purge_rate_limits
        n = expire_pending_orders()
        purge_rate_limits()
        db.session.commit()
        click.echo(f"{n} commande(s) expirée(s).")

    @app.cli.command("verify-audit")
    def verify_audit():
        """Vérifie l'intégrité du journal d'audit chaîné."""
        from .security import verify_audit_chain
        ok, count, bad = verify_audit_chain()
        if ok:
            click.echo(f"Journal intègre : {count} entrée(s).")
        else:
            raise click.ClickException(f"Anomalie détectée à l'entrée #{bad}.")

    @app.cli.command("bootstrap")
    def bootstrap_cmd():
        """Applique les migrations et crée le super administrateur défini par l'environnement."""
        bootstrap(app)
        click.echo("Base prête.")


def bootstrap(app):
    """Migrations + super administrateur depuis PLATFORM_ADMIN_EMAIL / _PASSWORD."""
    from flask_migrate import upgrade
    from werkzeug.security import generate_password_hash

    from .models import PLATFORM_ADMIN, User

    with app.app_context():
        upgrade()
        email = (os.environ.get("PLATFORM_ADMIN_EMAIL") or "").strip().lower()
        password = os.environ.get("PLATFORM_ADMIN_PASSWORD") or ""
        if email and len(password) >= 16 and not db.session.scalar(db.select(User).where(User.email == email)):
            db.session.add(User(email=email, full_name="Super administrateur", role=PLATFORM_ADMIN,
                                password_hash=generate_password_hash(password), must_change_password=True))
            db.session.commit()
