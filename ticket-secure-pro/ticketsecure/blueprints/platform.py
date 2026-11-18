"""Console du super administrateur de la plateforme."""
from decimal import Decimal, InvalidOperation

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy import func, select

from ..extensions import db
from ..models import AuditLog, Event, Order, Organization, Ticket, User
from ..security import audit, platform_required, verify_audit_chain

bp = Blueprint("platform", __name__, url_prefix="/plateforme")


@bp.route("/")
@platform_required
def organizations():
    orgs = db.session.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    sales = {oid: (n, total or 0, fee or 0) for oid, n, total, fee in db.session.execute(
        select(Order.organization_id, func.count(Order.id), func.sum(Order.amount), func.sum(Order.fee_amount))
        .where(Order.status == "paid").group_by(Order.organization_id)).all()}
    events = dict(db.session.execute(select(Event.organization_id, func.count(Event.id))
                                     .group_by(Event.organization_id)).all())
    members = dict(db.session.execute(select(User.organization_id, func.count(User.id))
                                      .where(User.organization_id.is_not(None))
                                      .group_by(User.organization_id)).all())
    totals = db.session.execute(select(func.count(Order.id), func.sum(Order.amount), func.sum(Order.fee_amount))
                                .where(Order.status == "paid")).one()
    tickets = db.session.scalar(select(func.count(Ticket.id))) or 0
    return render_template("platform/organizations.html", organizations=orgs, sales=sales, events=events,
                           members=members, totals=totals, tickets=tickets)


@bp.route("/organisations/<int:org_id>/statut", methods=["POST"])
@platform_required
def toggle_status(org_id):
    org = db.session.get(Organization, org_id) or abort(404)
    org.status = "suspended" if org.active else "active"
    audit("organization_status", f"{org.name} → {org.status}", organization_id=org.id)
    db.session.commit()
    flash(f"{org.name} : {'réactivée' if org.active else 'suspendue'}.", "success")
    return redirect(url_for("platform.organizations"))


@bp.route("/organisations/<int:org_id>/commission", methods=["POST"])
@platform_required
def set_fee(org_id):
    org = db.session.get(Organization, org_id) or abort(404)
    raw = request.form.get("fee_percent", "").strip().replace(",", ".")
    try:
        fee = None if raw == "" else Decimal(raw)
    except InvalidOperation:
        fee = Decimal(-1)
    if fee is not None and not (Decimal(0) <= fee <= Decimal(50)):
        flash("Commission entre 0 et 50 %.", "error")
    else:
        org.fee_percent = fee
        audit("organization_fee", f"{org.name} → {raw or 'taux plateforme'}", organization_id=org.id)
        db.session.commit()
        flash("Commission enregistrée.", "success")
    return redirect(url_for("platform.organizations"))


@bp.route("/audit")
@platform_required
def audit_log():
    entries = db.session.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(500)).all()
    ok, count, bad = verify_audit_chain()
    head = entries[0].entry_hash if entries else ""
    return render_template("platform/audit.html", entries=entries, chain_ok=ok, chain_count=count,
                           chain_bad=bad, head=head)
