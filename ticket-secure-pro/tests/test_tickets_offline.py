"""Émission, usage unique, affectations, API appareils et synchronisation hors connexion."""
import os
import threading
import uuid
from urllib.parse import quote
from datetime import datetime, timedelta, timezone

import pytest

from conftest import PASSWORD, login
from ticketsecure.extensions import db as _db
from ticketsecure.models import EventAssignment, ScanLog, Ticket, TicketCategory
from ticketsecure.tickets import issue_tickets, ticket_token, token_digest


def issue(event, n=1, category=None):
    tickets = issue_tickets(event, n, category=category)
    _db.session.commit()
    return tickets


def scan(client, token, event_id=None):
    return client.post("/espace/scanner/valider", json={"token": token, "event_id": event_id}).get_json()


def test_token_is_not_stored_in_clear(world):
    t = issue(world["ev_a"])[0]
    token = ticket_token(t)
    assert token.startswith("TSP3.") and token not in (t.token_hash, t.token_salt)
    assert t.token_hash == token_digest(token)


def test_generate_respects_capacity(client, world, db):
    world["ev_a"].capacity = 3
    db.session.commit()
    login(client, "admin@a.test")
    client.post(f"/espace/evenements/{world['ev_a'].id}/generer", data={"quantity": 2})
    r = client.post(f"/espace/evenements/{world['ev_a'].id}/generer", data={"quantity": 2})
    assert r.status_code == 302
    assert db.session.scalar(db.select(db.func.count(Ticket.id))) == 2


def test_print_and_pdf(client, world):
    login(client, "admin@a.test")
    client.post(f"/espace/evenements/{world['ev_a'].id}/generer", data={"quantity": 3})
    assert client.get(f"/espace/evenements/{world['ev_a'].id}/impression").status_code == 200
    r = client.get(f"/espace/evenements/{world['ev_a'].id}/impression.pdf")
    assert r.status_code == 200 and r.data[:4] == b"%PDF"


def test_single_use_validation(client, world):
    t = issue(world["ev_a"])[0]
    login(client, "super@a.test")
    assert scan(client, ticket_token(t))["status"] == "accepted"
    assert scan(client, ticket_token(t))["status"] == "duplicate"
    assert scan(client, "TSP3.faux")["status"] == "invalid"


def test_other_organization_ticket_is_unknown(client, world):
    t = issue(world["ev_b"])[0]
    login(client, "admin@a.test")
    response = scan(client, ticket_token(t))
    assert response["status"] == "invalid" and "event" not in response


def test_controller_limited_to_assigned_event_and_gate(client, world, db):
    ev = world["ev_a"]
    vip = TicketCategory(event_id=ev.id, name="VIP", price=20000)
    db.session.add(vip)
    db.session.commit()
    std_ticket = issue(ev, category=ev.categories[0])[0]
    vip_ticket = issue(ev, category=vip)[0]
    login(client, "ctrl@a.test")
    assert scan(client, ticket_token(std_ticket))["status"] == "wrong_event"  # pas affecté
    db.session.add(EventAssignment(user_id=world["ctrl"].id, event_id=ev.id, category_id=vip.id))
    db.session.commit()
    assert scan(client, ticket_token(std_ticket))["status"] == "wrong_event"  # mauvaise porte
    assert scan(client, ticket_token(vip_ticket))["status"] == "accepted"


def test_cancelled_ticket_refused(client, world):
    t = issue(world["ev_a"])[0]
    login(client, "admin@a.test")
    client.post(f"/espace/billets/{t.id}/annuler")
    assert scan(client, ticket_token(t))["status"] == "cancelled"


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL", "").startswith("postgres"),
                    reason="verrouillage de ligne testé sur PostgreSQL")
def test_concurrent_validation_only_one_accepted(app, world):
    from ticketsecure.tickets import validate_token
    from ticketsecure.models import User
    t = issue(world["ev_a"])[0]
    token, uid = ticket_token(t), world["admin"].id
    results, barrier = [], threading.Barrier(8)

    def worker():
        with app.test_request_context():
            user = _db.session.get(User, uid)
            barrier.wait()
            results.append(validate_token(token, user)["status"])
            _db.session.commit()
            _db.session.remove()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    [th.start() for th in threads]
    [th.join() for th in threads]
    assert sorted(results) == ["accepted"] + ["duplicate"] * 7


# --- API des appareils --------------------------------------------------------------------
def register(client, email, name="Tel"):
    r = client.post("/api/v1/appareils", json={"email": email, "password": PASSWORD, "device_name": name})
    assert r.status_code == 201, r.get_json()
    return {"Authorization": "Bearer " + r.get_json()["token"]}


def iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat()


def test_device_registration_requires_valid_credentials(client, world):
    r = client.post("/api/v1/appareils", json={"email": "ctrl@a.test", "password": "faux"})
    assert r.status_code == 401
    assert client.get("/api/v1/evenements").status_code == 401


def test_manifest_contains_hashes_only_and_respects_scope(client, world, db):
    ev = world["ev_a"]
    tickets = issue(ev, 3)
    tickets[0].holder = "Nom Confidentiel"
    db.session.commit()
    h = register(client, "ctrl@a.test")
    assert client.get("/api/v1/evenements", headers=h).get_json()["events"] == []
    assert client.get(f"/api/v1/evenements/{ev.id}/manifeste", headers=h).status_code == 404
    db.session.add(EventAssignment(user_id=world["ctrl"].id, event_id=ev.id))
    db.session.commit()
    data = client.get(f"/api/v1/evenements/{ev.id}/manifeste", headers=h).get_json()
    assert data["full"] and len(data["tickets"]) == 3
    body = str(data)
    assert ticket_token(tickets[0]) not in body and "Confidentiel" not in body
    assert data["tickets"][0][0] == tickets[0].token_hash[:32]
    assert client.get(f"/api/v1/evenements/{world['ev_b'].id}/manifeste", headers=h).status_code == 404


def test_offline_disabled_event_has_no_manifest(client, world, db):
    world["ev_a"].offline_scan_allowed = False
    db.session.commit()
    h = register(client, "admin@a.test")
    assert client.get(f"/api/v1/evenements/{world['ev_a'].id}/manifeste", headers=h).status_code == 403


def test_offline_sync_is_idempotent_and_detects_conflicts(client, world, db):
    ev = world["ev_a"]
    t1, t2 = issue(ev, 2)
    h1 = register(client, "admin@a.test", "Porte A")
    h2 = register(client, "super@a.test", "Porte B")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Appareil 1 hors ligne : admet t1 puis refuse un faux billet.
    scans1 = [
        {"id": str(uuid.uuid4()), "token": ticket_token(t1), "event_id": ev.id,
         "scanned_at": iso(now - timedelta(minutes=5)), "local_result": "accepted"},
        {"id": str(uuid.uuid4()), "token": "TSP3.inconnu", "event_id": ev.id,
         "scanned_at": iso(now - timedelta(minutes=4)), "local_result": "invalid"},
    ]
    r = client.post("/api/v1/synchroniser", json={"scans": scans1}, headers=h1).get_json()
    assert [x["status"] for x in r["results"]] == ["accepted", "invalid"]
    db.session.expire_all()
    assert db.session.get(Ticket, t1.id).status == "used"

    # Renvoi du même lot (réseau coupé pendant la réponse) : aucun effet.
    r = client.post("/api/v1/synchroniser", json={"scans": scans1}, headers=h1).get_json()
    assert all(x.get("duplicate_upload") for x in r["results"])
    assert db.session.scalar(db.select(db.func.count(ScanLog.id))) == 2

    # Appareil 2, resté hors ligne, avait aussi admis t1 : conflit signalé.
    r = client.post("/api/v1/synchroniser", headers=h2, json={"scans": [
        {"id": str(uuid.uuid4()), "token": ticket_token(t1), "event_id": ev.id,
         "scanned_at": iso(now - timedelta(minutes=3)), "local_result": "accepted"}]}).get_json()
    assert r["results"][0]["status"] == "conflict"
    from ticketsecure.models import AuditLog
    assert db.session.scalar(db.select(AuditLog).where(AuditLog.action == "offline_conflict"))

    # Le delta du manifeste informe l'appareil 2 des billets utilisés ailleurs.
    since = quote(iso(now - timedelta(minutes=1)))
    delta = client.get(f"/api/v1/evenements/{ev.id}/manifeste?depuis={since}", headers=h2).get_json()
    assert not delta["full"]
    assert {row[1]: row[2] for row in delta["tickets"]}[t1.ticket_no] == "used"
    # Un billet non modifié depuis longtemps n'est pas renvoyé dans le delta.
    t2.updated_at = now - timedelta(hours=2)
    db.session.commit()
    delta = client.get(f"/api/v1/evenements/{ev.id}/manifeste?depuis={since}", headers=h2).get_json()
    assert t2.ticket_no not in str(delta)


def test_online_api_validation(client, world):
    t = issue(world["ev_a"])[0]
    h = register(client, "admin@a.test")
    r = client.post("/api/v1/valider", json={"token": ticket_token(t), "event_id": world["ev_a"].id}, headers=h)
    assert r.get_json()["status"] == "accepted"
    r = client.post("/api/v1/valider", json={"token": ticket_token(t)}, headers=h)
    assert r.get_json()["status"] == "duplicate"


def test_revoked_device_is_rejected(client, world):
    h = register(client, "admin@a.test")
    login(client, "admin@a.test")
    from ticketsecure.models import Device
    device = _db.session.scalar(_db.select(Device))
    client.post(f"/espace/appareils/{device.id}/revoquer")
    r = client.get("/api/v1/evenements", headers=h)
    assert r.status_code == 401 and r.get_json()["error"] == "device_revoked"


def test_deactivating_member_revokes_devices(client, world):
    h = register(client, "ctrl@a.test")
    login(client, "admin@a.test")
    client.post(f"/espace/equipe/{world['ctrl'].id}/statut")
    assert client.get("/api/v1/evenements", headers=h).status_code == 401


def test_cors_only_for_allowed_origins(client, world):
    ok = client.options("/api/v1/appareils", headers={"Origin": "https://appassets.androidplatform.net",
                                                      "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("Access-Control-Allow-Origin") == "https://appassets.androidplatform.net"
    bad = client.options("/api/v1/appareils", headers={"Origin": "https://evil.test"})
    assert "Access-Control-Allow-Origin" not in bad.headers


def test_csv_export_neutralises_formulas(client, world, db):
    t = issue(world["ev_a"])[0]
    t.holder = "=HYPERLINK(\"http://x\")"
    db.session.commit()
    login(client, "admin@a.test")
    body = client.get(f"/espace/evenements/{world['ev_a'].id}/billets.csv").data.decode("utf-8-sig")
    assert "'=HYPERLINK" in body
