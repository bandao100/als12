"""Billetterie publique : catalogue, API publique, commande depuis un site partenaire,
affiches, page Intégration, mise à la une."""
import io
import os
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from PIL import Image

from conftest import login, make_event
from ticketsecure.delivery import order_access_key
from ticketsecure.models import Event, Order, Organization, utcnow

PARTNER = "https://partenaire.test"


def png_bytes(size=(800, 600), color=(200, 40, 90)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    buf.seek(0)
    return buf


def allow_partner(db, org):
    org.embed_origins = PARTNER
    db.session.commit()


def api_order(client, event, qty=2, origin=PARTNER, return_url=PARTNER + "/billetterie#/agenda", provider="simulation"):
    headers = {"Origin": origin} if origin else {}
    return client.post("/api/public/v1/commandes", headers=headers, json={
        "event_id": event.id,
        "items": [{"category_id": event.categories[0].id, "quantity": qty}],
        "customer": {"name": "Awa Traoré", "email": "awa@client.test", "phone": "+226 70 00 00 00"},
        "provider": provider, "accept_terms": True, "return_url": return_url,
    })


# --- Catalogue ---------------------------------------------------------------------------------
def test_catalogue_filters_and_visibility(client, world, db):
    a, b = world["a"], world["b"]
    world["ev_a"].genre, world["ev_a"].city = "concert", "Ouagadougou"
    world["ev_b"].genre, world["ev_b"].city = "sport", "Bobo-Dioulasso"
    make_event(a, "Brouillon caché", status="draft")
    past = make_event(a, "Déjà passé")
    past.starts_at = utcnow() - timedelta(days=3)
    db.session.commit()

    data = client.get("/api/public/v1/evenements").get_json()
    names = {e["name"] for e in data["events"]}
    assert names == {"Concert A", "Concert B"} and data["total"] == 2
    assert client.get("/api/public/v1/evenements?genre=sport").get_json()["events"][0]["name"] == "Concert B"
    assert client.get("/api/public/v1/evenements?ville=ouagadougou").get_json()["total"] == 1
    assert client.get("/api/public/v1/evenements?q=Concert%20B").get_json()["total"] == 1
    assert client.get(f"/api/public/v1/evenements?organisateur={a.slug}").get_json()["total"] == 1
    page = client.get("/api/public/v1/evenements?par_page=1&page=2").get_json()
    assert page["pages"] == 2 and len(page["events"]) == 1

    b.status = "suspended"
    db.session.commit()
    assert client.get("/api/public/v1/evenements").get_json()["total"] == 1

    cities = client.get(f"/api/public/v1/villes?organisateur={a.slug}").get_json()["cities"]
    assert cities == ["Ouagadougou"]


def test_event_detail_and_config(client, world):
    ev = world["ev_a"]
    data = client.get(f"/api/public/v1/evenements/{world['a'].slug}/{ev.slug}").get_json()["event"]
    assert data["categories"][0]["price"] == 5000 and data["min_price_label"].startswith("5")
    assert [p["code"] for p in data["providers"]] == ["simulation"]
    assert client.get(f"/api/public/v1/evenements/{world['b'].slug}/{ev.slug}").status_code == 404
    config = client.get("/api/public/v1/config").get_json()
    assert config["currency"] == "XOF" and any(g["code"] == "concert" for g in config["genres"])


def test_read_endpoints_are_open_to_all_origins(client, world):
    r = client.get("/api/public/v1/evenements", headers={"Origin": "https://nimporte.test"})
    assert r.headers["Access-Control-Allow-Origin"] == "*"


# --- Commande depuis un site partenaire ----------------------------------------------------------
def test_partner_order_full_flow(client, world, db):
    allow_partner(db, world["a"])
    pre = client.options("/api/public/v1/commandes", headers={
        "Origin": PARTNER, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert pre.headers.get("Access-Control-Allow-Origin") == PARTNER

    r = api_order(client, world["ev_a"])
    assert r.status_code == 201, r.get_json()
    assert r.headers["Access-Control-Allow-Origin"] == PARTNER
    data = r.get_json()
    order = db.session.scalar(db.select(Order).where(Order.ref == data["ref"]))
    assert data["key"] == order_access_key(order) and data["status"] == "pending"
    assert data["payment_url"].startswith("http://billets.test/paiement/simulation/")
    assert order.return_url == PARTNER + "/billetterie#/agenda"

    status = client.get(f"/api/public/v1/commandes/{data['ref']}?cle={data['key']}").get_json()
    assert status["status"] == "pending" and status["tickets"] == []

    # Paiement (simulé), puis retour sur le site partenaire avec la référence de commande.
    r = client.post(f"/paiement/simulation/{data['ref']}", data={"decision": "pay"})
    r = client.get(r.location)
    assert r.status_code == 302
    target = urlsplit(r.location)
    assert f"{target.scheme}://{target.netloc}" == PARTNER and target.fragment == "/agenda"
    assert parse_qs(target.query)["tsp_commande"] == [data["ref"]]

    status = client.get(f"/api/public/v1/commandes/{data['ref']}?cle={data['key']}").get_json()
    assert status["status"] == "paid" and len(status["tickets"]) == 2
    assert status["tickets"][0]["qr_url"].startswith("http://billets.test/commande/")
    assert client.get(urlsplit(status["tickets"][0]["qr_url"]).path).mimetype == "image/png"
    assert status["pdf_url"] and status["order_url"]


def test_order_status_requires_secret_key(client, world, db):
    allow_partner(db, world["a"])
    data = api_order(client, world["ev_a"]).get_json()
    assert client.get(f"/api/public/v1/commandes/{data['ref']}?cle={'0' * 32}").status_code == 404
    assert client.get(f"/api/public/v1/commandes/{data['ref']}").status_code == 404


def test_unauthorized_origins_are_refused(client, world, db):
    allow_partner(db, world["a"])
    r = api_order(client, world["ev_a"], origin="https://pirate.test")
    assert r.status_code == 403
    assert client.options("/api/public/v1/commandes", headers={
        "Origin": "https://pirate.test", "Access-Control-Request-Method": "POST"}).headers.get(
        "Access-Control-Allow-Origin") is None
    # Redirection ouverte impossible : la page de retour doit appartenir à un site autorisé.
    assert api_order(client, world["ev_a"], return_url="https://pirate.test/vol").status_code == 400
    assert api_order(client, world["ev_a"], return_url="javascript:alert(1)").status_code == 400
    # Un site autorisé pour l'organisateur A ne vend pas les billets de B.
    assert api_order(client, world["ev_b"], return_url=PARTNER + "/x").status_code == 403
    assert db.session.scalar(db.select(db.func.count(Order.id))) == 0


def test_cancelled_payment_returns_with_flag(client, world, db):
    allow_partner(db, world["a"])
    data = api_order(client, world["ev_a"]).get_json()
    r = client.get(f"/paiement/retour/{data['ref']}?error=1")
    assert parse_qs(urlsplit(r.location).query)["tsp_annule"] == ["1"]


def test_free_tickets_via_api(client, world, db):
    allow_partner(db, world["a"])
    world["ev_a"].categories[0].price = 0
    db.session.commit()
    data = api_order(client, world["ev_a"], provider="").get_json()
    assert data["status"] == "paid" and data["payment_url"] is None
    assert "tsp_commande=" + data["ref"] in data["next_url"]


def test_api_order_validation_errors(client, world, db):
    allow_partner(db, world["a"])
    ev = world["ev_a"]
    r = client.post("/api/public/v1/commandes", headers={"Origin": PARTNER}, json={
        "event_id": ev.id, "items": [{"category_id": ev.categories[0].id, "quantity": 1}],
        "customer": {"name": "X", "email": "pas-un-email"}, "provider": "simulation", "accept_terms": True})
    assert r.status_code == 400
    world["ev_a"].capacity = 1
    db.session.commit()
    assert api_order(client, ev, qty=2).status_code == 409


# --- Affiches ----------------------------------------------------------------------------------------
def test_poster_upload_is_reencoded_and_served(client, world, db, app):
    login(client, "admin@a.test")
    r = client.post("/espace/evenements", content_type="multipart/form-data", data={
        "name": "Festival Affiche", "starts_at": "2030-06-01T18:00", "genre": "festival",
        "poster": (png_bytes(), "affiche.png")})
    assert r.status_code == 302
    event = db.session.scalar(db.select(Event).where(Event.name == "Festival Affiche"))
    assert event.genre == "festival" and event.poster.endswith(".webp")
    served = client.get(f"/media/affiches/{event.poster}")
    assert served.status_code == 200 and served.mimetype == "image/webp" and served.data[:4] == b"RIFF"
    assert client.get("/media/affiches/..%2Fsecret.webp").status_code == 404

    path = os.path.join(app.config["MEDIA_FOLDER"], "affiches", event.poster)
    client.post(f"/espace/evenements/{event.id}/modifier", data={
        "name": event.name, "starts_at": "2030-06-01T18:00", "genre": "festival", "remove_poster": "1"})
    db.session.expire_all()
    assert db.session.get(Event, event.id).poster is None and not os.path.exists(path)


def test_non_image_poster_is_rejected(client, world, db):
    login(client, "admin@a.test")
    r = client.post("/espace/evenements", content_type="multipart/form-data", data={
        "name": "Faux fichier", "starts_at": "2030-06-01T18:00",
        "poster": (io.BytesIO(b"<script>alert(1)</script>"), "affiche.png")}, follow_redirects=True)
    assert "pas une image valide" in r.get_data(as_text=True)
    assert db.session.scalar(db.select(Event).where(Event.name == "Faux fichier")) is None


# --- Intégration et mise à la une -------------------------------------------------------------------
def test_integration_page_saves_only_valid_origins(client, world, db):
    login(client, "admin@a.test")
    page = client.get("/espace/integration").get_data(as_text=True)
    assert f'organisateur="{world["a"].slug}"' in page and "billetterie.js" in page
    client.post("/espace/integration", data={"embed_origins":
                "https://www.monsite.com/agenda\nhttp://insecure.test\nftp://x.test\nhttp://localhost:8080"})
    assert db.session.get(Organization, world["a"].id).embed_origin_list == [
        "https://www.monsite.com", "http://localhost:8080"]
    login(client, "super@a.test")
    assert client.get("/espace/integration").status_code == 403


def test_platform_features_events(client, world, db):
    login(client, "root@plateforme.test")
    assert client.get("/plateforme/evenements").status_code == 200
    client.post(f"/plateforme/evenements/{world['ev_a'].id}/une")
    assert db.session.get(Event, world["ev_a"].id).featured
    featured = client.get("/api/public/v1/evenements?a_la_une=1").get_json()["events"]
    assert [e["name"] for e in featured] == ["Concert A"]
    assert "À la une" in client.get("/").get_data(as_text=True)


def test_marketplace_pages_with_filters(client, world, db):
    world["ev_a"].genre, world["ev_a"].city = "concert", "Ouagadougou"
    db.session.commit()
    page = client.get("/?genre=concert&ville=Ouagadougou").get_data(as_text=True)
    assert "Concert A" in page and "Concert B" not in page
    assert client.get(f"/o/{world['a'].slug}?q=Concert").status_code == 200
    for asset in ("/static/embed/billetterie.js", "/static/embed/billetterie.css"):
        assert client.get(asset).status_code == 200
