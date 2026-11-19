"""Espace organisateur : événements, billets, ventes, contrôleurs, appareils, audit."""
import csv
import io

from flask import (Blueprint, abort, flash, jsonify, redirect, render_template, request, send_file,
                   session, url_for)
from sqlalchemy import case, func, or_, select

from ..delivery import order_page_url, qr_png, send_order_tickets, tickets_pdf
from ..extensions import db
from ..media import PosterError, delete_poster, save_poster
from ..models import (ADMIN, CONTROLLER, GENRES, SUPERVISOR, AuditLog, Device, Event, EventAssignment, Order,
                      ScanLog, Ticket, TicketCategory, User, utcnow)
from ..orders import confirm_payment, mark_failed
from ..payments import get_provider
from ..security import audit, current_user, org_scoped, permission_required
from ..tickets import (available, category_for_event, issue_tickets, lock_event, scannable_events,
                       ticket_token, validate_token)
from ..utils import local_input_to_utc, slugify, utc_to_input

bp = Blueprint("admin", __name__, url_prefix="/espace")

EVENT_STATUSES = {"draft": "Brouillon", "published": "Publié", "closed": "Ventes closes",
                  "cancelled": "Annulé"}


def _int(value, default=0, lo=None, hi=None):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if lo is not None and n < lo:
        return default
    if hi is not None and n > hi:
        return default
    return n


def csv_safe(value):
    """Neutralise les formules dans les exports CSV ouverts dans un tableur."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_response(rows, header, filename):
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_safe(v) for v in row])
    return send_file(io.BytesIO(out.getvalue().encode("utf-8-sig")), mimetype="text/csv",
                     as_attachment=True, download_name=filename)


def _event_stats(org_id):
    used = func.sum(case((Ticket.status == "used", 1), else_=0))
    rows = db.session.execute(
        select(Event, func.count(Ticket.id), used)
        .outerjoin(Ticket, (Ticket.event_id == Event.id) & (Ticket.status != "cancelled"))
        .where(Event.organization_id == org_id)
        .group_by(Event.id).order_by(Event.starts_at.desc())
    ).all()
    revenue = dict(db.session.execute(
        select(Order.event_id, func.sum(Order.amount)).where(Order.organization_id == org_id,
                                                             Order.status == "paid")
        .group_by(Order.event_id)).all())
    return [(e, total or 0, used_ or 0, revenue.get(e.id, 0) or 0) for e, total, used_ in rows]


@bp.route("/")
@permission_required("events.manage")
def dashboard():
    user = current_user()
    return render_template("admin/dashboard.html", events=_event_stats(user.organization_id),
                           organization=user.organization, statuses=EVENT_STATUSES, genres=GENRES)


# --- Événements ----------------------------------------------------------------------
def _unique_slug(org_id, name, exclude_id=None):
    base = slugify(name)
    slug, n = base, 2
    while True:
        q = select(Event.id).where(Event.organization_id == org_id, Event.slug == slug)
        if exclude_id:
            q = q.where(Event.id != exclude_id)
        if not db.session.scalar(q):
            return slug
        slug, n = f"{base}-{n}", n + 1


def _event_from_form(event, form):
    name = form.get("name", "").strip()[:180]
    starts_at = local_input_to_utc(form.get("starts_at", ""))
    if not name or not starts_at:
        return "Le nom et la date sont obligatoires."
    event.name = name
    event.starts_at = starts_at
    event.venue = form.get("venue", "").strip()[:180]
    event.city = form.get("city", "").strip()[:120]
    event.description = form.get("description", "").strip()[:4000]
    event.capacity = _int(form.get("capacity"), 0, lo=0, hi=1_000_000)
    event.online_sales = form.get("online_sales") == "1"
    event.offline_scan_allowed = form.get("offline_scan_allowed") == "1"
    genre = form.get("genre", "autre")
    event.genre = genre if genre in GENRES else "autre"
    return None


def _apply_poster(event):
    """Enregistre, remplace ou retire l'affiche envoyée avec le formulaire. Retourne une erreur ou None."""
    upload = request.files.get("poster")
    if upload and upload.filename:
        try:
            name = save_poster(upload)
        except PosterError as exc:
            return str(exc)
        delete_poster(event.poster)
        event.poster = name
    elif request.form.get("remove_poster") == "1" and event.poster:
        delete_poster(event.poster)
        event.poster = None
    return None


@bp.route("/evenements", methods=["POST"])
@permission_required("events.manage")
def create_event():
    user = current_user()
    event = Event(organization_id=user.organization_id)
    error = _event_from_form(event, request.form) or _apply_poster(event)
    if error:
        db.session.rollback()
        flash(error, "error")
        return redirect(url_for("admin.dashboard"))
    event.slug = _unique_slug(user.organization_id, event.name)
    db.session.add(event)
    db.session.flush()
    # Catégorie par défaut, modifiable ensuite.
    price = _int(request.form.get("price"), 0, lo=0)
    db.session.add(TicketCategory(event_id=event.id, name="Standard", price=price))
    audit("event_created", f"#{event.id} {event.name}")
    db.session.commit()
    flash("Événement créé en brouillon. Vérifiez les catégories puis publiez-le.", "success")
    return redirect(url_for("admin.event_detail", event_id=event.id))


@bp.route("/evenements/<int:event_id>")
@permission_required("events.manage", "sales.view")
def event_detail(event_id):
    event = org_scoped(Event, event_id)
    user = current_user()
    q = request.args.get("q", "").strip()
    tq = select(Ticket).where(Ticket.event_id == event.id)
    if q:
        like = f"%{q[:60]}%"
        tq = tq.where(or_(Ticket.ticket_no.ilike(like), Ticket.holder.ilike(like)))
    tickets = db.session.scalars(tq.order_by(Ticket.id.desc()).limit(100)).all()
    counts = dict(db.session.execute(
        select(Ticket.status, func.count(Ticket.id)).where(Ticket.event_id == event.id)
        .group_by(Ticket.status)).all())
    per_category = {cid: (n or 0) for cid, n in db.session.execute(
        select(Ticket.category_id, func.count(Ticket.id))
        .where(Ticket.event_id == event.id, Ticket.status != "cancelled")
        .group_by(Ticket.category_id)).all()}
    revenue = db.session.scalar(select(func.coalesce(func.sum(Order.amount), 0))
                                .where(Order.event_id == event.id, Order.status == "paid")) or 0
    members = db.session.scalars(select(User).where(User.organization_id == user.organization_id,
                                                    User.role.in_((CONTROLLER, SUPERVISOR)),
                                                    User.active.is_(True)).order_by(User.full_name)).all()
    conflicts = db.session.scalar(select(func.count(ScanLog.id)).where(ScanLog.event_id == event.id,
                                                                       ScanLog.result == "conflict")) or 0
    return render_template("admin/event.html", event=event, tickets=tickets, counts=counts,
                           per_category=per_category, revenue=revenue, members=members, q=q,
                           conflicts=conflicts, statuses=EVENT_STATUSES, starts_input=utc_to_input(event.starts_at),
                           genres=GENRES,
                           remaining=available(event))


@bp.route("/evenements/<int:event_id>/modifier", methods=["POST"])
@permission_required("events.manage")
def update_event(event_id):
    event = org_scoped(Event, event_id)
    error = _event_from_form(event, request.form) or _apply_poster(event)
    if error:
        db.session.rollback()
        flash(error, "error")
    else:
        audit("event_updated", f"#{event.id} {event.name}")
        db.session.commit()
        flash("Événement mis à jour.", "success")
    return redirect(url_for("admin.event_detail", event_id=event_id))


@bp.route("/evenements/<int:event_id>/statut", methods=["POST"])
@permission_required("events.manage")
def event_status(event_id):
    event = org_scoped(Event, event_id)
    status = request.form.get("status")
    if status not in EVENT_STATUSES:
        abort(400)
    if status == "published" and not event.categories:
        flash("Ajoutez au moins une catégorie de billets avant de publier.", "error")
        return redirect(url_for("admin.event_detail", event_id=event_id))
    event.status = status
    audit("event_status", f"#{event.id} {event.name} → {status}")
    db.session.commit()
    flash(f"Statut : {EVENT_STATUSES[status]}.", "success")
    return redirect(url_for("admin.event_detail", event_id=event_id))


@bp.route("/evenements/<int:event_id>/categories", methods=["POST"])
@permission_required("events.manage")
def add_category(event_id):
    event = org_scoped(Event, event_id)
    name = request.form.get("name", "").strip()[:120]
    if not name:
        flash("Nom de catégorie requis.", "error")
    else:
        db.session.add(TicketCategory(event_id=event.id, name=name,
                                      price=_int(request.form.get("price"), 0, lo=0),
                                      quota=_int(request.form.get("quota"), 0, lo=0)))
        audit("category_created", f"#{event.id} {name}")
        db.session.commit()
        flash("Catégorie ajoutée.", "success")
    return redirect(url_for("admin.event_detail", event_id=event.id))


@bp.route("/categories/<int:category_id>", methods=["POST"])
@permission_required("events.manage")
def update_category(category_id):
    category = db.session.get(TicketCategory, category_id)
    if not category:
        abort(404)
    event = org_scoped(Event, category.event_id)
    category.name = request.form.get("name", category.name).strip()[:120] or category.name
    category.price = _int(request.form.get("price"), category.price, lo=0)
    category.quota = _int(request.form.get("quota"), category.quota, lo=0)
    category.on_sale = request.form.get("on_sale") == "1"
    audit("category_updated", f"#{event.id} {category.name} · {category.price} · quota {category.quota}")
    db.session.commit()
    flash("Catégorie mise à jour.", "success")
    return redirect(url_for("admin.event_detail", event_id=event.id))


# --- Billets émis au guichet / invitations ----------------------------------------------
@bp.route("/evenements/<int:event_id>/generer", methods=["POST"])
@permission_required("tickets.generate")
def generate(event_id):
    event = org_scoped(Event, event_id)
    qty = _int(request.form.get("quantity"), 0, lo=1, hi=500)
    category = category_for_event(event, request.form.get("category_id"))
    if not qty:
        flash("Quantité autorisée : de 1 à 500 billets par lot.", "error")
        return redirect(url_for("admin.event_detail", event_id=event.id))
    event = lock_event(event.id)
    left = available(event, category)
    if left is not None and qty > left:
        db.session.rollback()
        flash(f"Capacité dépassée : {left} place(s) disponible(s).", "error")
        return redirect(url_for("admin.event_detail", event_id=event.id))
    tickets = issue_tickets(event, qty, category=category, holder=request.form.get("holder", "").strip())
    audit("tickets_generated", f"{qty} billet(s) · #{event.id} {event.name}"
          + (f" · {category.name}" if category else ""))
    db.session.commit()
    session["print_batch"] = {"event_id": event.id, "ids": [t.id for t in tickets]}
    return redirect(url_for("admin.print_tickets", event_id=event.id))


def _tickets_for_print(event):
    ids = request.args.getlist("id", type=int)
    if not ids:
        batch = session.get("print_batch") or {}
        if batch.get("event_id") == event.id:
            ids = batch.get("ids", [])
    if not ids:
        return []
    return db.session.scalars(select(Ticket).where(Ticket.event_id == event.id, Ticket.id.in_(ids[:500]))
                              .order_by(Ticket.id)).all()


@bp.route("/evenements/<int:event_id>/impression")
@permission_required("tickets.generate")
def print_tickets(event_id):
    event = org_scoped(Event, event_id)
    tickets = _tickets_for_print(event)
    if not tickets:
        flash("Aucun billet à imprimer.", "error")
        return redirect(url_for("admin.event_detail", event_id=event.id))
    return render_template("admin/print.html", event=event, tickets=tickets)


@bp.route("/evenements/<int:event_id>/impression.pdf")
@permission_required("tickets.generate")
def print_pdf(event_id):
    from flask import current_app
    event = org_scoped(Event, event_id)
    tickets = _tickets_for_print(event)
    if not tickets:
        abort(404)
    audit("tickets_pdf", f"{len(tickets)} billet(s) · #{event.id}")
    db.session.commit()
    return send_file(io.BytesIO(tickets_pdf(tickets, current_app.config["PLATFORM_NAME"])),
                     mimetype="application/pdf", as_attachment=True,
                     download_name=f"billets-{event.slug}.pdf")


@bp.route("/billets/<int:ticket_id>/qr.png")
@permission_required("tickets.generate")
def ticket_qr(ticket_id):
    ticket = org_scoped(Ticket, ticket_id)
    return send_file(qr_png(ticket_token(ticket)), mimetype="image/png", max_age=0)


@bp.route("/billets/<int:ticket_id>/annuler", methods=["POST"])
@permission_required("tickets.cancel")
def cancel_ticket(ticket_id):
    ticket = org_scoped(Ticket, ticket_id)
    ticket = db.session.scalar(select(Ticket).where(Ticket.id == ticket.id).with_for_update())
    if ticket.status == "valid":
        ticket.status = "cancelled"
        audit("ticket_cancelled", ticket.ticket_no)
        db.session.commit()
        flash(f"Billet {ticket.ticket_no} annulé.", "success")
    else:
        flash("Seul un billet non utilisé peut être annulé.", "error")
    return redirect(url_for("admin.event_detail", event_id=ticket.event_id))


@bp.route("/evenements/<int:event_id>/historique")
@permission_required("events.manage", "sales.view")
def history(event_id):
    event = org_scoped(Event, event_id)
    result = request.args.get("result", "")
    q = select(ScanLog).where(ScanLog.event_id == event.id)
    if result:
        q = q.where(ScanLog.result == result)
    logs = db.session.scalars(q.order_by(ScanLog.scanned_at.desc()).limit(500)).all()
    summary = dict(db.session.execute(select(ScanLog.result, func.count(ScanLog.id))
                                      .where(ScanLog.event_id == event.id).group_by(ScanLog.result)).all())
    return render_template("admin/history.html", event=event, logs=logs, summary=summary, result=result)


@bp.route("/evenements/<int:event_id>/billets.csv")
@permission_required("events.manage", "sales.view")
def export_tickets(event_id):
    event = org_scoped(Event, event_id)
    tickets = db.session.scalars(select(Ticket).where(Ticket.event_id == event.id).order_by(Ticket.id)).all()
    audit("tickets_exported", f"#{event.id}")
    db.session.commit()
    rows = [(t.ticket_no, t.category.name if t.category else "", t.holder, t.source, t.status,
             t.order.ref if t.order else "", t.created_at, t.used_at or "") for t in tickets]
    return csv_response(rows, ["Numéro", "Catégorie", "Titulaire", "Origine", "Statut", "Commande",
                               "Création UTC", "Validation UTC"], f"billets-{event.slug}.csv")


# --- Ventes en ligne -------------------------------------------------------------------
@bp.route("/ventes")
@permission_required("sales.view")
def sales():
    user = current_user()
    status = request.args.get("status", "paid")
    q = select(Order).where(Order.organization_id == user.organization_id)
    if status:
        q = q.where(Order.status == status)
    event_id = request.args.get("event", type=int)
    if event_id:
        q = q.where(Order.event_id == event_id)
    orders = db.session.scalars(q.order_by(Order.created_at.desc()).limit(300)).all()
    totals = db.session.execute(
        select(Order.provider, func.count(Order.id), func.sum(Order.amount), func.sum(Order.fee_amount))
        .where(Order.organization_id == user.organization_id, Order.status == "paid")
        .group_by(Order.provider)).all()
    events = db.session.scalars(select(Event).where(Event.organization_id == user.organization_id)
                                .order_by(Event.starts_at.desc())).all()
    return render_template("admin/sales.html", orders=orders, totals=totals, status=status,
                           events=events, event_id=event_id)


@bp.route("/commandes/<int:order_id>")
@permission_required("sales.view")
def order_detail(order_id):
    order = org_scoped(Order, order_id)
    from ..models import EmailOutbox
    emails = db.session.scalars(select(EmailOutbox).where(EmailOutbox.order_id == order.id)
                                .order_by(EmailOutbox.id.desc())).all()
    return render_template("admin/order.html", order=order, emails=emails,
                           page_url=order_page_url(order) if order.status == "paid" else None)


@bp.route("/commandes/<int:order_id>/renvoyer", methods=["POST"])
@permission_required("orders.manage")
def resend_order(order_id):
    order = org_scoped(Order, order_id)
    if order.status != "paid":
        abort(400)
    email = request.form.get("email", "").strip().lower()
    from ..utils import valid_email
    if email and valid_email(email) and email != order.customer_email:
        audit("order_email_changed", f"{order.ref} : {order.customer_email} → {email}")
        order.customer_email = email
    entry = send_order_tickets(order)
    audit("order_tickets_resent", f"{order.ref} → {order.customer_email} ({entry.status})")
    db.session.commit()
    flash("Billets renvoyés." if entry.status == "sent" else f"Envoi impossible : {entry.last_error}",
          "success" if entry.status == "sent" else "error")
    return redirect(url_for("admin.order_detail", order_id=order.id))


@bp.route("/commandes/<int:order_id>/verifier", methods=["POST"])
@permission_required("orders.manage")
def verify_order(order_id):
    """Interroge le prestataire de paiement (utile si une notification s'est perdue)."""
    order = org_scoped(Order, order_id)
    provider = get_provider(order.provider)
    if not provider or order.status == "paid":
        return redirect(url_for("admin.order_detail", order_id=order.id))
    status, amount, currency, txn = provider.verify(order)
    if status == "paid":
        order, newly = confirm_payment(order.id, amount=amount, currency=currency, txn=txn,
                                       source="vérification manuelle")
        db.session.commit()
        if newly:
            send_order_tickets(order)
            db.session.commit()
        flash("Paiement confirmé par le prestataire. Billets émis.", "success")
    elif status == "failed":
        mark_failed(order, "· vérification manuelle")
        db.session.commit()
        flash("Le prestataire indique un paiement échoué ou expiré.", "error")
    else:
        flash("Paiement toujours en attente chez le prestataire.", "error")
    return redirect(url_for("admin.order_detail", order_id=order.id))


@bp.route("/ventes.csv")
@permission_required("sales.view")
def export_sales():
    user = current_user()
    orders = db.session.scalars(select(Order).where(Order.organization_id == user.organization_id)
                                .order_by(Order.id)).all()
    audit("sales_exported", "")
    db.session.commit()
    rows = [(o.ref, o.event.name, o.customer_name, o.customer_email, o.customer_phone, o.quantity, o.amount,
             o.fee_amount, o.amount - o.fee_amount, o.currency, o.provider, o.status, o.provider_txn or "",
             o.created_at, o.paid_at or "") for o in orders]
    return csv_response(rows, ["Commande", "Événement", "Client", "E-mail", "Téléphone", "Billets", "Montant",
                               "Commission", "Net organisateur", "Devise", "Moyen", "Statut", "Transaction",
                               "Création UTC", "Paiement UTC"], "ventes.csv")


# --- Affectations des contrôleurs ------------------------------------------------------
@bp.route("/evenements/<int:event_id>/affectations", methods=["POST"])
@permission_required("team.manage_controllers")
def add_assignment(event_id):
    event = org_scoped(Event, event_id)
    member = org_scoped(User, _int(request.form.get("user_id")))
    if member.role not in (CONTROLLER, SUPERVISOR):
        abort(400)
    category = category_for_event(event, request.form.get("category_id"))
    existing = db.session.scalar(select(EventAssignment).where(EventAssignment.user_id == member.id,
                                                               EventAssignment.event_id == event.id))
    assignment = existing or EventAssignment(user_id=member.id, event_id=event.id)
    assignment.category_id = category.id if category else None
    assignment.gate = request.form.get("gate", "").strip()[:60]
    db.session.add(assignment)
    audit("assignment_set", f"{member.email} → #{event.id} {event.name}"
          + (f" · {category.name}" if category else "") + (f" · {assignment.gate}" if assignment.gate else ""))
    db.session.commit()
    flash(f"{member.full_name} affecté(e) à l'événement.", "success")
    return redirect(url_for("admin.event_detail", event_id=event.id) + "#controleurs")


@bp.route("/affectations/<int:assignment_id>/supprimer", methods=["POST"])
@permission_required("team.manage_controllers")
def remove_assignment(assignment_id):
    assignment = db.session.get(EventAssignment, assignment_id)
    if not assignment:
        abort(404)
    event = org_scoped(Event, assignment.event_id)
    audit("assignment_removed", f"{assignment.user.email} ✕ #{event.id}")
    db.session.delete(assignment)
    db.session.commit()
    flash("Affectation retirée.", "success")
    return redirect(url_for("admin.event_detail", event_id=event.id) + "#controleurs")


# --- Appareils de contrôle -------------------------------------------------------------
@bp.route("/appareils")
@permission_required("devices.manage")
def devices():
    user = current_user()
    rows = db.session.scalars(select(Device).where(Device.organization_id == user.organization_id)
                              .order_by(Device.revoked_at.is_not(None), Device.last_seen_at.desc())).all()
    pending = dict(db.session.execute(
        select(ScanLog.device_id, func.count(ScanLog.id))
        .where(ScanLog.organization_id == user.organization_id, ScanLog.result == "conflict")
        .group_by(ScanLog.device_id)).all())
    return render_template("admin/devices.html", devices=rows, conflicts=pending, now=utcnow())


@bp.route("/appareils/<int:device_id>/revoquer", methods=["POST"])
@permission_required("devices.manage")
def revoke_device(device_id):
    device = org_scoped(Device, device_id)
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        audit("device_revoked", f"{device.name} ({device.user.email})")
        db.session.commit()
        flash("Appareil révoqué : il ne peut plus valider ni synchroniser.", "success")
    return redirect(url_for("admin.devices"))


# --- Journal d'audit -----------------------------------------------------------------------
@bp.route("/audit")
@permission_required("audit.view")
def audit_log():
    user = current_user()
    action = request.args.get("action", "")
    q = select(AuditLog).where(AuditLog.organization_id == user.organization_id)
    if action:
        q = q.where(AuditLog.action == action)
    entries = db.session.scalars(q.order_by(AuditLog.id.desc()).limit(500)).all()
    actions = db.session.scalars(select(AuditLog.action).where(AuditLog.organization_id == user.organization_id)
                                 .distinct().order_by(AuditLog.action)).all()
    return render_template("admin/audit.html", entries=entries, actions=actions, action=action)


@bp.route("/audit.csv")
@permission_required("audit.view")
def export_audit():
    user = current_user()
    entries = db.session.scalars(select(AuditLog).where(AuditLog.organization_id == user.organization_id)
                                 .order_by(AuditLog.id)).all()
    rows = [(e.id, e.created_at, e.actor, e.action, e.detail, e.ip, e.entry_hash) for e in entries]
    return csv_response(rows, ["#", "Date UTC", "Auteur", "Action", "Détail", "IP", "Empreinte"], "audit.csv")


# --- Paramètres de l'organisation ----------------------------------------------------------
@bp.route("/parametres", methods=["GET", "POST"])
@permission_required("settings.manage")
def settings():
    org = current_user().organization
    if request.method == "POST":
        name = request.form.get("name", "").strip()[:160]
        if not name:
            flash("Le nom est obligatoire.", "error")
        else:
            org.name = name
            org.contact_email = request.form.get("contact_email", "").strip()[:190]
            org.contact_phone = request.form.get("contact_phone", "").strip()[:40]
            audit("organization_updated", name)
            db.session.commit()
            flash("Paramètres enregistrés.", "success")
        return redirect(url_for("admin.settings"))
    return render_template("admin/settings.html", organization=org)


@bp.route("/integration", methods=["GET", "POST"])
@permission_required("settings.manage")
def integration():
    """Sites autorisés à intégrer la billetterie de l'organisation, et code à copier."""
    from .public_api import _origin_of
    org = current_user().organization
    if request.method == "POST":
        origins, rejected = [], []
        for line in request.form.get("embed_origins", "").splitlines()[:20]:
            line = line.strip()
            if not line:
                continue
            origin = _origin_of(line)
            (origins if origin else rejected).append(origin or line)
        if rejected:
            flash("Adresses ignorées (https:// obligatoire) : " + ", ".join(rejected[:5]), "error")
        org.embed_origins = "\n".join(dict.fromkeys(origins))
        audit("embed_origins_updated", ", ".join(origins) or "aucun site")
        db.session.commit()
        flash("Sites autorisés enregistrés.", "success")
        return redirect(url_for("admin.integration"))
    from ..payments.base import external_url
    events = db.session.scalars(select(Event).where(Event.organization_id == org.id, Event.status == "published")
                                .order_by(Event.starts_at)).all()
    return render_template("admin/integration.html", organization=org, events=events,
                           script_url=external_url("static", filename="embed/billetterie.js"),
                           api_url=external_url("public_api.list_events"))


# --- Scanner web (en ligne) ---------------------------------------------------------------
@bp.route("/scanner")
@permission_required("scan")
def scanner():
    return render_template("admin/scanner.html", events=scannable_events(current_user()))


@bp.route("/scanner/valider", methods=["POST"])
@permission_required("scan")
def scanner_validate():
    data = request.get_json(silent=True) or {}
    try:
        response = validate_token(str(data.get("token", "")), current_user(),
                                  event_id=_int(data.get("event_id")) or None)
        db.session.commit()
    except Exception:  # noqa: BLE001
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Erreur de validation")
        return jsonify(ok=False, status="error", message="ERREUR TECHNIQUE — RÉESSAYEZ"), 500
    return jsonify(response)


ROLE_ORDER = {ADMIN: 0, SUPERVISOR: 1, CONTROLLER: 2}
