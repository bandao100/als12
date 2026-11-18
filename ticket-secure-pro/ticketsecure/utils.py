import re
import unicodedata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from flask import current_app


def slugify(value, max_len=60):
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:max_len].strip("-") or "evenement"


def tz():
    return ZoneInfo(current_app.config["APP_TIMEZONE"])


def to_local(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(tz())


def fmt_dt(dt, fmt="%d/%m/%Y %H:%M"):
    local = to_local(dt)
    return local.strftime(fmt) if local else "—"


def local_input_to_utc(value):
    """Convertit une valeur de champ ``datetime-local`` (heure locale) en UTC naïf."""
    try:
        local = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if local.tzinfo is None:
        local = local.replace(tzinfo=tz())
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def utc_to_input(dt):
    local = to_local(dt)
    return local.strftime("%Y-%m-%dT%H:%M") if local else ""


def money(amount, currency=None):
    currency = currency or current_app.config["CURRENCY"]
    text = f"{int(amount or 0):,}".replace(",", " ")
    return f"{text} {'F CFA' if currency in ('XOF', 'XAF') else currency}"


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def valid_email(value):
    return bool(value) and len(value) <= 190 and bool(EMAIL_RE.match(value))


PHONE_RE = re.compile(r"^\+?[0-9 ]{8,20}$")


def valid_phone(value):
    return bool(PHONE_RE.match(value or ""))
