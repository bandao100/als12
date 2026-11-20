"""Gestion des accès : administrateurs, superviseurs et contrôleurs."""
import secrets

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy import select
from werkzeug.security import generate_password_hash

from ..extensions import db
from ..models import ADMIN, CONTROLLER, ORG_ROLES, SUPERVISOR, Device, Event, EventAssignment, User, utcnow
from ..security import audit, current_user, org_scoped, password_problem, permission_required
from ..utils import valid_email

bp = Blueprint("team", __name__, url_prefix="/espace/equipe")

MANAGE_PERMISSION = {ADMIN: "team.manage_admins", SUPERVISOR: "team.manage_supervisors",
                     CONTROLLER: "team.manage_controllers"}


def can_manage(actor, role):
    return role in MANAGE_PERMISSION and actor.can(MANAGE_PERMISSION[role])


def _temporary_password():
    return secrets.token_urlsafe(12)


@bp.route("/", methods=["GET", "POST"])
@permission_required("team.view")
def members():
    user = current_user()
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        name = request.form.get("name", "").strip()[:140]
        role = request.form.get("role", CONTROLLER)
        password = request.form.get("password", "") or _temporary_password()
        problem = password_problem(password, email)
        if role not in ORG_ROLES or not can_manage(user, role):
            abort(403)
        if not name or not valid_email(email):
            flash("Nom et adresse e-mail valides obligatoires.", "error")
        elif problem:
            flash(problem, "error")
        elif db.session.scalar(select(User).where(User.email == email)):
            flash("Cette adresse e-mail possède déjà un compte.", "error")
        else:
            member = User(organization_id=user.organization_id, email=email, full_name=name,
                          phone=request.form.get("phone", "").strip()[:40], role=role,
                          password_hash=generate_password_hash(password), must_change_password=True)
            db.session.add(member)
            db.session.flush()
            for event_id in request.form.getlist("event_ids", type=int):
                event = db.session.get(Event, event_id)
                if event and event.organization_id == user.organization_id:
                    db.session.add(EventAssignment(user_id=member.id, event_id=event.id))
            audit("member_created", f"{email} · {role}")
            db.session.commit()
            flash(f"Compte créé. Mot de passe provisoire à transmettre de façon sûre : {password} "
                  "(il devra être changé à la première connexion).", "success")
            return redirect(url_for("team.members"))
    rows = db.session.scalars(select(User).where(User.organization_id == user.organization_id)
                              .order_by(User.active.desc(), User.role, User.full_name)).all()
    events = db.session.scalars(select(Event).where(Event.organization_id == user.organization_id,
                                                    Event.status != "cancelled")
                                .order_by(Event.starts_at.desc())).all()
    creatable = [r for r in ORG_ROLES if can_manage(user, r)]
    return render_template("team/members.html", members=rows, events=events, creatable=creatable,
                           can_manage=lambda r: can_manage(user, r))


def _managed_member(member_id):
    actor = current_user()
    member = org_scoped(User, member_id)
    if member.id == actor.id or not can_manage(actor, member.role):
        abort(403)
    return actor, member


@bp.route("/<int:member_id>/role", methods=["POST"])
@permission_required("team.view")
def change_role(member_id):
    actor, member = _managed_member(member_id)
    role = request.form.get("role")
    if role not in ORG_ROLES or not can_manage(actor, role):
        abort(403)
    if member.role != role:
        audit("member_role_changed", f"{member.email} : {member.role} → {role}")
        member.role = role
        member.session_version += 1  # nouvelle connexion avec les nouveaux droits
        db.session.commit()
        flash("Rôle modifié.", "success")
    return redirect(url_for("team.members"))


@bp.route("/<int:member_id>/statut", methods=["POST"])
@permission_required("team.view")
def toggle_active(member_id):
    _actor, member = _managed_member(member_id)
    member.active = not member.active
    member.session_version += 1
    if not member.active:
        # Un compte désactivé perd aussi ses appareils de contrôle.
        for device in db.session.scalars(select(Device).where(Device.user_id == member.id,
                                                              Device.revoked_at.is_(None))):
            device.revoked_at = utcnow()
    audit("member_activated" if member.active else "member_deactivated", member.email)
    db.session.commit()
    flash("Compte réactivé." if member.active else "Compte désactivé et appareils révoqués.", "success")
    return redirect(url_for("team.members"))


@bp.route("/<int:member_id>/mot-de-passe", methods=["POST"])
@permission_required("team.view")
def reset_member_password(member_id):
    _actor, member = _managed_member(member_id)
    password = _temporary_password()
    member.password_hash = generate_password_hash(password)
    member.must_change_password = True
    member.session_version += 1
    audit("member_password_reset", member.email)
    db.session.commit()
    flash(f"Nouveau mot de passe provisoire pour {member.email} : {password}", "success")
    return redirect(url_for("team.members"))
