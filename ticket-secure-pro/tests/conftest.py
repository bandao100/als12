"""Tests : SQLite par défaut, PostgreSQL si TEST_DATABASE_URL est défini.

    TEST_DATABASE_URL=postgresql://user:pass@localhost/ticketsecure_test pytest
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from werkzeug.security import generate_password_hash  # noqa: E402

from ticketsecure import create_app  # noqa: E402
from ticketsecure.extensions import db as _db  # noqa: E402
from ticketsecure.models import (ADMIN, CONTROLLER, PLATFORM_ADMIN, SUPERVISOR, Event,  # noqa: E402
                                 Organization, TicketCategory, User, utcnow)

PASSWORD = "Mot-de-passe-solide-2026"


@pytest.fixture
def app(tmp_path):
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"
    os.environ["DATABASE_URL"] = url
    app = create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": False,
        "SERVER_NAME": "billets.test",
        "PAYMENT_SIMULATION": True,
        "MAIL_SERVER": "",
        "MEDIA_FOLDER": str(tmp_path / "media"),
    })
    with app.app_context():
        _db.drop_all()
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def db(app):
    return _db


@pytest.fixture
def client(app):
    return app.test_client()


def make_org(name="Org A"):
    org = Organization(name=name, slug=re.sub(r"\W+", "-", name.lower()))
    _db.session.add(org)
    _db.session.flush()
    return org


def make_user(org, role, email, password=PASSWORD, **kw):
    user = User(organization_id=org.id if org else None, email=email, full_name=email.split("@")[0],
                role=role, password_hash=generate_password_hash(password), **kw)
    _db.session.add(user)
    _db.session.flush()
    return user


def make_event(org, name="Concert", capacity=0, status="published", price=5000, **kw):
    from datetime import timedelta
    event = Event(organization_id=org.id, name=name, slug=re.sub(r"\W+", "-", name.lower()),
                  starts_at=utcnow() + timedelta(days=7), capacity=capacity, status=status, **kw)
    _db.session.add(event)
    _db.session.flush()
    cat = TicketCategory(event_id=event.id, name="Standard", price=price)
    _db.session.add(cat)
    _db.session.flush()
    return event


@pytest.fixture
def world(db):
    """Deux organisations avec leurs équipes et un événement chacune."""
    a = make_org("Org A")
    b = make_org("Org B")
    users = {
        "root": make_user(None, PLATFORM_ADMIN, "root@plateforme.test"),
        "admin": make_user(a, ADMIN, "admin@a.test"),
        "super": make_user(a, SUPERVISOR, "super@a.test"),
        "ctrl": make_user(a, CONTROLLER, "ctrl@a.test"),
        "ctrl2": make_user(a, CONTROLLER, "ctrl2@a.test"),
        "admin_b": make_user(b, ADMIN, "admin@b.test"),
    }
    ev_a = make_event(a, "Concert A")
    ev_b = make_event(b, "Concert B")
    db.session.commit()
    return {"a": a, "b": b, "ev_a": ev_a, "ev_b": ev_b, **users}


def login(client, email, password=PASSWORD):
    return client.post("/connexion", data={"email": email, "password": password})
