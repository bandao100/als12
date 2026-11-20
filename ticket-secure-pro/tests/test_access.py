"""Authentification, rôles, isolation entre organisateurs, sécurité HTTP."""
import pytest

from conftest import PASSWORD, login
from ticketsecure import create_app
from ticketsecure.models import AuditLog, Organization, User
from ticketsecure.security import verify_audit_chain


def test_register_creates_isolated_admin_space(client, db):
    r = client.post("/inscription", data={"organization": "Festival Sud", "name": "Awa", "email": "awa@sud.test",
                                          "password": PASSWORD, "accept": "1"})
    assert r.status_code == 302
    user = db.session.scalar(db.select(User).where(User.email == "awa@sud.test"))
    assert user.role == "admin" and user.organization.name == "Festival Sud"
    assert client.get("/espace/").status_code == 200


def test_register_rejects_weak_password(client, db):
    r = client.post("/inscription", data={"organization": "X", "name": "Y", "email": "y@x.test",
                                          "password": "court", "accept": "1"})
    assert r.status_code == 400
    assert db.session.scalar(db.select(Organization)) is None


@pytest.mark.parametrize("who,path,expected", [
    ("ctrl", "/espace/", 403),
    ("ctrl", "/espace/equipe/", 403),
    ("ctrl", "/espace/scanner", 200),
    ("super", "/espace/", 200),
    ("super", "/espace/parametres", 403),
    ("super", "/espace/equipe/", 200),
    ("admin", "/espace/parametres", 200),
    ("admin", "/plateforme/", 403),
    ("root", "/plateforme/", 200),
    ("root", "/espace/", 403),
])
def test_role_permissions(client, world, who, path, expected):
    login(client, world[who].email)
    assert client.get(path).status_code == expected


def test_supervisor_can_create_controller_but_not_admin(client, world, db):
    login(client, "super@a.test")
    r = client.post("/espace/equipe/", data={"name": "X", "email": "x@a.test", "role": "admin"})
    assert r.status_code == 403
    r = client.post("/espace/equipe/", data={"name": "C", "email": "c3@a.test", "role": "controller",
                                             "event_ids": [world["ev_a"].id]})
    assert r.status_code == 302
    member = db.session.scalar(db.select(User).where(User.email == "c3@a.test"))
    assert member.must_change_password and member.assignments[0].event_id == world["ev_a"].id


def test_new_member_must_change_password(client, world, db):
    world["ctrl"].must_change_password = True
    db.session.commit()
    login(client, "ctrl@a.test")
    r = client.get("/espace/scanner")
    assert r.status_code == 302 and "/mot-de-passe" in r.location


def test_organizations_are_isolated(client, world):
    login(client, "admin@b.test")
    assert client.get(f"/espace/evenements/{world['ev_a'].id}").status_code == 404
    assert client.post(f"/espace/evenements/{world['ev_a'].id}/generer", data={"quantity": 1}).status_code == 404


def test_deactivated_member_loses_session(client, world, db):
    login(client, "super@a.test")
    assert client.get("/espace/").status_code == 200
    login(client.application.test_client(), "admin@a.test")
    world["super"].active = False
    world["super"].session_version += 1
    db.session.commit()
    assert client.get("/espace/").status_code == 302


def test_suspended_organization_cannot_login(client, world, db):
    world["a"].status = "suspended"
    db.session.commit()
    r = login(client, "admin@a.test")
    assert r.status_code == 401


def test_login_rate_limit(client, world):
    for _ in range(5):
        assert login(client, "admin@a.test", "mauvais-mot-de-passe").status_code == 401
    r = login(client, "admin@a.test")  # bon mot de passe, mais compte temporairement bloqué
    assert r.status_code == 401 and "Trop de tentatives" in r.get_data(as_text=True)


def test_csrf_is_enforced(world):
    app = create_app({"TESTING": True, "WTF_CSRF_ENABLED": True})
    with app.app_context():
        r = app.test_client().post("/connexion", data={"email": "admin@a.test", "password": PASSWORD})
        assert r.status_code == 400


def test_security_headers(client):
    r = client.get("/")
    csp = r.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp
    assert r.headers["X-Frame-Options"] == "DENY"


def test_production_refuses_unsafe_configuration(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///x.db")
    with pytest.raises(RuntimeError) as exc:
        create_app()
    assert "SECRET_KEY" in str(exc.value) and "PostgreSQL" in str(exc.value)


def test_audit_chain_detects_tampering(client, world, db):
    login(client, "admin@a.test")
    client.post("/espace/evenements", data={"name": "Gala", "starts_at": "2030-01-01T20:00"})
    ok, count, _ = verify_audit_chain()
    assert ok and count >= 2
    entry = db.session.scalar(db.select(AuditLog).where(AuditLog.action == "login"))
    entry.detail = "falsifié"
    db.session.commit()
    ok, _, bad = verify_audit_chain()
    assert not ok and bad == entry.id


def test_platform_admin_suspends_organization(client, world, db):
    login(client, "root@plateforme.test")
    client.post(f"/plateforme/organisations/{world['a'].id}/statut")
    assert db.session.get(Organization, world["a"].id).status == "suspended"


def test_password_reset_link_is_single_use(client, world, app):
    from itsdangerous import URLSafeTimedSerializer
    user = world["ctrl"]
    token = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="password-reset").dumps(
        {"u": user.id, "v": user.session_version})
    new = "Nouveau-mot-de-passe-2026"
    assert client.post(f"/reinitialiser/{token}", data={"password": new, "confirm": new}).status_code == 302
    assert login(client, "ctrl@a.test", new).status_code == 302
    r = client.post(f"/reinitialiser/{token}", data={"password": "Autre-mot-de-passe-99", "confirm": "Autre-mot-de-passe-99"})
    assert r.status_code == 302 and "oublie" in r.location


def test_member_cannot_manage_self_or_higher_role(client, world):
    login(client, "super@a.test")
    assert client.post(f"/espace/equipe/{world['admin'].id}/statut").status_code == 403
    assert client.post(f"/espace/equipe/{world['super'].id}/statut").status_code == 403
    assert client.post(f"/espace/equipe/{world['ctrl'].id}/statut").status_code == 302


def test_new_admin_member_by_admin(client, world, db):
    login(client, "admin@a.test")
    r = client.post("/espace/equipe/", data={"name": "Co", "email": "co@a.test", "role": "admin"})
    assert r.status_code == 302
    assert db.session.scalar(db.select(User).where(User.email == "co@a.test")).role == "admin"
