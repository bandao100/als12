"""Remise des billets au client : PDF, QR et e-mail."""
import hashlib
import hmac
import io
import smtplib
import ssl
from email.message import EmailMessage

import qrcode
from flask import current_app, render_template
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .extensions import db
from .models import EmailOutbox, utcnow
from .payments.base import external_url
from .tickets import ticket_token
from .utils import fmt_dt, money


def order_access_key(order):
    """Clé secrète de la page client d'une commande (non stockée, dérivée)."""
    key = current_app.config["TICKET_SECRET"].encode("utf-8")
    return hmac.new(key, ("order:" + order.ref).encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def order_page_url(order):
    return external_url("shop.order_page", ref=order.ref, key=order_access_key(order))


def qr_png(data, box_size=8):
    img = qrcode.make(data, box_size=box_size, border=2,
                      error_correction=qrcode.constants.ERROR_CORRECT_M)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def tickets_pdf(tickets, platform_name):
    """PDF A4, trois billets par page, avec QR code."""
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    pdf.setTitle("Billets")
    width, height = A4
    block_h = (height - 30 * mm) / 3
    for index, ticket in enumerate(tickets):
        slot = index % 3
        if index and slot == 0:
            pdf.showPage()
        top = height - 15 * mm - slot * block_h
        x0, y0, w, h = 15 * mm, top - block_h + 5 * mm, width - 30 * mm, block_h - 10 * mm
        pdf.setStrokeColorRGB(0.75, 0.8, 0.85)
        pdf.roundRect(x0, y0, w, h, 4 * mm)
        pdf.drawImage(ImageReader(qr_png(ticket_token(ticket))), x0 + w - h + 2 * mm, y0 + 2 * mm,
                      h - 4 * mm, h - 4 * mm)
        event = ticket.event
        tx = x0 + 8 * mm
        pdf.setFillColorRGB(0.07, 0.16, 0.25)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(tx, y0 + h - 10 * mm, f"{platform_name.upper()} · ACCÈS UNIQUE")
        pdf.setFont("Helvetica-Bold", 17)
        pdf.drawString(tx, y0 + h - 19 * mm, event.name[:42])
        pdf.setFont("Helvetica", 10)
        pdf.drawString(tx, y0 + h - 26 * mm, f"{fmt_dt(event.starts_at)} · {event.venue} {event.city}"[:80])
        pdf.drawString(tx, y0 + h - 33 * mm, f"Catégorie : {ticket.category.name if ticket.category else 'Standard'}")
        if ticket.holder:
            pdf.drawString(tx, y0 + h - 40 * mm, f"Titulaire : {ticket.holder}"[:70])
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(tx, y0 + 16 * mm, ticket.ticket_no)
        pdf.setFont("Helvetica", 7.5)
        pdf.drawString(tx, y0 + 9 * mm, "Une seule entrée autorisée. Ne partagez pas ce QR code :")
        pdf.drawString(tx, y0 + 5 * mm, "la première personne qui le présente entre, les copies sont refusées.")
    pdf.save()
    buf.seek(0)
    return buf.getvalue()


def _smtp_send(message):
    cfg = current_app.config
    context = ssl.create_default_context()
    if cfg["MAIL_USE_SSL"]:
        server = smtplib.SMTP_SSL(cfg["MAIL_SERVER"], cfg["MAIL_PORT"], context=context, timeout=20)
    else:
        server = smtplib.SMTP(cfg["MAIL_SERVER"], cfg["MAIL_PORT"], timeout=20)
        if cfg["MAIL_USE_TLS"]:
            server.starttls(context=context)
    try:
        if cfg["MAIL_USERNAME"]:
            server.login(cfg["MAIL_USERNAME"], cfg["MAIL_PASSWORD"])
        server.send_message(message)
    finally:
        server.quit()


def send_email(to_email, subject, text_body, html_body=None, attachments=(), *, kind="generic",
               order=None, organization_id=None):
    """Envoie un e-mail et trace l'envoi dans ``EmailOutbox``. Ne lève pas d'exception."""
    cfg = current_app.config
    entry = EmailOutbox(to_email=to_email, subject=subject[:200], kind=kind,
                        order_id=order.id if order else None,
                        organization_id=organization_id or (order.organization_id if order else None))
    db.session.add(entry)
    entry.attempts = (entry.attempts or 0) + 1
    if not cfg["MAIL_SERVER"]:
        entry.status = "not_configured"
        entry.last_error = "MAIL_SERVER non configuré : e-mail non envoyé"
        current_app.logger.warning("E-mail non envoyé (SMTP non configuré) : %s → %s", subject, to_email)
        return entry
    message = EmailMessage()
    message["From"] = cfg["MAIL_FROM"]
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    for filename, mimetype, data in attachments:
        maintype, subtype = mimetype.split("/", 1)
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    try:
        _smtp_send(message)
        entry.status = "sent"
        entry.sent_at = utcnow()
        entry.last_error = ""
    except Exception as exc:  # noqa: BLE001 — on trace toute erreur SMTP
        entry.status = "failed"
        entry.last_error = f"{exc.__class__.__name__}: {exc}"[:300]
        current_app.logger.exception("Échec d'envoi d'e-mail")
    return entry


def send_order_tickets(order):
    """Envoie au client le lien vers ses billets et le PDF en pièce jointe."""
    cfg = current_app.config
    tickets = sorted(order.tickets, key=lambda t: t.id)
    context = dict(order=order, tickets=tickets, url=order_page_url(order),
                   platform=cfg["PLATFORM_NAME"], money=money, fmt_dt=fmt_dt)
    pdf = tickets_pdf(tickets, cfg["PLATFORM_NAME"])
    entry = send_email(
        order.customer_email,
        f"Vos billets — {order.event.name} (commande {order.ref})",
        render_template("emails/tickets.txt", **context),
        render_template("emails/tickets.html", **context),
        attachments=[(f"billets-{order.ref}.pdf", "application/pdf", pdf)],
        kind="order_tickets", order=order,
    )
    if entry.status == "sent":
        order.tickets_sent_at = utcnow()
    return entry
