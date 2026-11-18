"""Toutes les pages s'affichent pour les rôles autorisés (détection d'erreurs de gabarit)."""
from conftest import login
from ticketsecure.models import EventAssignment
from ticketsecure.tickets import issue_tickets


def test_admin_pages_render(client, world, db):
    ev = world["ev_a"]
    issue_tickets(ev, 2, category=ev.categories[0])
    db.session.add(EventAssignment(user_id=world["ctrl"].id, event_id=ev.id, gate="Porte A"))
    db.session.commit()
    login(client, "admin@a.test")
    for path in ["/espace/", f"/espace/evenements/{ev.id}", f"/espace/evenements/{ev.id}?q=TS",
                 f"/espace/evenements/{ev.id}/historique", "/espace/ventes", "/espace/ventes?status=",
                 "/espace/equipe/", "/espace/appareils", "/espace/audit", "/espace/parametres",
                 "/espace/scanner", "/mot-de-passe", "/espace/audit.csv"]:
        r = client.get(path)
        assert r.status_code == 200, path


def test_event_lifecycle_via_forms(client, world, db):
    login(client, "admin@a.test")
    r = client.post("/espace/evenements", data={"name": "Gala 2030", "starts_at": "2030-05-01T20:00",
                                                "capacity": "100", "price": "2500", "online_sales": "1"})
    event_id = int(r.location.rstrip("/").split("/")[-1])
    client.post(f"/espace/evenements/{event_id}/categories", data={"name": "VIP", "price": "10000", "quota": "10"})
    client.post(f"/espace/evenements/{event_id}/statut", data={"status": "published"})
    from ticketsecure.models import Event
    event = db.session.get(Event, event_id)
    assert event.status == "published" and [c.name for c in event.categories] == ["Standard", "VIP"]
    assert event.starts_at.hour == 20  # Ouagadougou = UTC+0
    page = client.get(f"/o/{world['a'].slug}/{event.slug}").get_data(as_text=True)
    assert "VIP" in page and "10 restant(s)" in page


def test_platform_pages_render(client, world):
    login(client, "root@plateforme.test")
    assert client.get("/plateforme/").status_code == 200
    page = client.get("/plateforme/audit")
    assert page.status_code == 200 and "intègre" in page.get_data(as_text=True)


def test_static_scanner_is_served(client):
    for path in ["/static/scanner/index.html", "/static/scanner/app.js", "/static/scanner/sw.js",
                 "/static/scanner/jsQR.js", "/static/scanner/manifest.webmanifest"]:
        assert client.get(path).status_code == 200, path
