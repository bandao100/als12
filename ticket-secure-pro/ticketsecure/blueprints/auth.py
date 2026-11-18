import secrets

from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from ..delivery import send_email
from ..extensions import db
from ..models import ADMIN, PLATFORM_ADMIN, Organization, User
from ..payments.base import external_url
from ..security import (audit, authenticate, client_ip, current_user, login_required, login_user,
                        password_problem, rate_hit, rate_limited)
from ..utils import slugify, valid_email

bp = Blueprint("auth", __name__)


def _safe_next(target):
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return None


def home_for(user):
    if user.role == PLATFORM_ADMIN:
        return url_for("platform.organizations")
    if user.can("events.manage"):
        return url_for("admin.dashboard")
    return url_for("admin.scanner")


@bp.route("/connexion", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user, error = authenticate(request.form.get("email"), request.form.get("password"))
        if error:
            flash(error, "error")
            return render_template("auth/login.html"), 401
        login_user(user)
        audit("login", user.email, user=user)
        db.session.commit()
        return redirect(_safe_next(request.args.get("next")) or home_for(user))
    if current_user():
        return redirect(home_for(current_user()))
    return render_template("auth/login.html")


@bp.route("/deconnexion", methods=["POST"])
@login_required
def logout():
    audit("logout", current_user().email)
    db.session.commit()
    session.clear()
    flash("Vous êtes déconnecté.", "success")
    return redirect(url_for("auth.login"))


@bp.route("/inscription", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        form = request.form
        org_name = form.get("organization", "").strip()[:160]
        name = form.get("name", "").strip()[:140]
        email = form.get("email", "").strip().lower()
        phone = form.get("phone", "").strip()[:40]
        password = form.get("password", "")
        error = None
        if rate_limited("register_ip", client_ip(), 5, 60):
            error = "Trop d'inscriptions depuis cette connexion. Réessayez plus tard."
        elif not org_name or not name or not valid_email(email):
            error = "Tous les champs sont requis et l'adresse e-mail doit être valide."
        elif form.get("accept") != "1":
            error = "Vous devez accepter les conditions d'utilisation."
        else:
            error = password_problem(password, email)
        if not error and db.session.scalar(select(User).where(User.email == email)):
            error = "Cette adresse e-mail possède déjà un compte."
        if error:
            flash(error, "error")
            return render_template("auth/register.html", form=form), 400
        org = Organization(name=org_name, slug=f"{slugify(org_name, 40)}-{secrets.token_hex(2)}",
                           contact_email=email, contact_phone=phone)
        db.session.add(org)
        db.session.flush()
        user = User(organization_id=org.id, email=email, full_name=name, phone=phone,
                    password_hash=generate_password_hash(password), role=ADMIN)
        db.session.add(user)
        db.session.flush()
        rate_hit("register_ip", client_ip())
        login_user(user)
        audit("organization_registered", org_name, user=user)
        db.session.commit()
        flash("Votre espace est prêt. Créez votre premier événement.", "success")
        return redirect(url_for("admin.dashboard"))
    return render_template("auth/register.html", form={})


@bp.route("/mot-de-passe", methods=["GET", "POST"])
@login_required
def change_password():
    user = current_user()
    if request.method == "POST":
        current = request.form.get("current", "")
        new = request.form.get("password", "")
        problem = password_problem(new, user.email)
        if not check_password_hash(user.password_hash, current):
            flash("Mot de passe actuel incorrect.", "error")
        elif new != request.form.get("confirm", ""):
            flash("Les deux mots de passe ne correspondent pas.", "error")
        elif new == current:
            flash("Choisissez un mot de passe différent de l'actuel.", "error")
        elif problem:
            flash(problem, "error")
        else:
            user.password_hash = generate_password_hash(new)
            user.must_change_password = False
            user.session_version += 1  # déconnecte les autres sessions
            audit("password_changed", user.email, user=user)
            login_user(user)
            db.session.commit()
            flash("Mot de passe modifié.", "success")
            return redirect(home_for(user))
    return render_template("auth/change_password.html", forced=user.must_change_password)


def _reset_serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="password-reset")


@bp.route("/mot-de-passe-oublie", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        if not rate_limited("reset_ip", client_ip(), 5, 60) and not rate_limited("reset_email", email, 3, 60):
            rate_hit("reset_ip", client_ip())
            rate_hit("reset_email", email)
            user = db.session.scalar(select(User).where(User.email == email, User.active.is_(True)))
            if user:
                token = _reset_serializer().dumps({"u": user.id, "v": user.session_version})
                link = external_url("auth.reset_password", token=token)
                send_email(user.email, "Réinitialisation de votre mot de passe",
                           render_template("emails/reset.txt", user=user, link=link),
                           kind="password_reset", organization_id=user.organization_id)
                audit("password_reset_requested", user.email, user=user)
            db.session.commit()
        # Même réponse que l'adresse existe ou non.
        flash("Si un compte correspond à cette adresse, un lien valable une heure vient d'être envoyé.", "success")
        return redirect(url_for("auth.login"))
    return render_template("auth/forgot.html")


@bp.route("/reinitialiser/<token>", methods=["GET", "POST"])
def reset_password(token):
    try:
        data = _reset_serializer().loads(token, max_age=3600)
    except (SignatureExpired, BadSignature):
        flash("Lien invalide ou expiré.", "error")
        return redirect(url_for("auth.forgot_password"))
    user = db.session.get(User, data.get("u"))
    if not user or not user.active or user.session_version != data.get("v"):
        flash("Ce lien a déjà été utilisé ou n'est plus valable.", "error")
        return redirect(url_for("auth.forgot_password"))
    if request.method == "POST":
        new = request.form.get("password", "")
        problem = password_problem(new, user.email)
        if new != request.form.get("confirm", ""):
            problem = "Les deux mots de passe ne correspondent pas."
        if problem:
            flash(problem, "error")
        else:
            user.password_hash = generate_password_hash(new)
            user.must_change_password = False
            user.session_version += 1
            audit("password_reset", user.email, user=user)
            db.session.commit()
            flash("Mot de passe réinitialisé. Vous pouvez vous connecter.", "success")
            return redirect(url_for("auth.login"))
    return render_template("auth/reset.html", token=token)
