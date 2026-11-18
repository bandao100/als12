"""Billetterie client et paiements : simulation, Wave, Orange Money, carte (Stripe)."""
import hashlib
import hmac
import json
import time

import pytest

from ticketsecure.delivery import order_access_key
from ticketsecure.models import EmailOutbox, Order, PaymentNotification, Ticket


class FakeResponse:
    def __init__(self, status, data):
        self.status_code = status
        self._data = data

    def json(self):
        return self._data


def buy(client, world, provider="simulation", qty=2, email="client@mail.test"):
    ev = world["ev_a"]
    cat = ev.categories[0]
    return client.post(f"/o/{world['a'].slug}/{ev.slug}/commander", data={
        "name": "Client Test", "email": email, "phone": "+226 70 00 00 00",
        f"qty_{cat.id}": qty, "provider": provider, "accept": "1"})


def last_order(db):
    return db.session.scalar(db.select(Order).order_by(Order.id.desc()))


def test_public_pages(client, world):
    assert client.get("/").status_code == 200
    assert client.get(f"/o/{world['a'].slug}").status_code == 200
    assert client.get(f"/o/{world['a'].slug}/{world['ev_a'].slug}").status_code == 200
    assert client.get(f"/o/{world['b'].slug}/{world['ev_a'].slug}").status_code == 404


def test_draft_event_not_for_sale(client, world, db):
    world["ev_a"].status = "draft"
    db.session.commit()
    assert client.get(f"/o/{world['a'].slug}/{world['ev_a'].slug}").status_code == 404


def test_simulated_purchase_issues_tickets_once(client, world, db):
    r = buy(client, world)
    order = last_order(db)
    assert r.status_code == 303 and order.status == "pending" and order.amount == 10000
    assert not order.tickets
    # Le retour client seul ne suffit pas.
    client.get(f"/paiement/retour/{order.ref}")
    assert last_order(db).status == "pending"
    r = client.post(f"/paiement/simulation/{order.ref}", data={"decision": "pay"})
    r = client.get(r.location)
    db.session.expire_all()
    order = last_order(db)
    assert order.status == "paid" and len(order.tickets) == 2
    assert order.fee_amount == 500  # 5 % par défaut
    assert all(t.source == "online" and t.holder == "Client Test" for t in order.tickets)
    # Le navigateur qui a passé la commande est redirigé vers ses billets.
    assert r.status_code == 302 and order_access_key(order) in r.location
    # Re-confirmation : aucun billet supplémentaire.
    client.post(f"/paiement/simulation/{order.ref}", data={"decision": "pay"})
    assert db.session.scalar(db.select(db.func.count(Ticket.id))) == 2
    outbox = db.session.scalar(db.select(EmailOutbox))
    assert outbox.kind == "order_tickets" and outbox.status == "not_configured"


def test_order_page_requires_secret_key(client, world, db):
    buy(client, world)
    order = last_order(db)
    client.post(f"/paiement/simulation/{order.ref}", data={"decision": "pay"})
    key = order_access_key(order)
    assert client.get(f"/commande/{order.ref}/{key}").status_code == 200
    assert client.get(f"/commande/{order.ref}/{'0' * 32}").status_code == 404
    ticket = order.tickets[0]
    assert client.get(f"/commande/{order.ref}/{key}/billet/{ticket.id}.png").mimetype == "image/png"
    assert client.get(f"/commande/{order.ref}/{key}/billets.pdf").data[:4] == b"%PDF"
    # Un autre visiteur connaissant la référence n'obtient pas les billets.
    other = client.application.test_client()
    page = other.get(f"/paiement/retour/{order.ref}")
    assert page.status_code == 200 and key not in page.get_data(as_text=True)


def test_pending_orders_hold_capacity(client, world, db):
    world["ev_a"].capacity = 3
    db.session.commit()
    buy(client, world, qty=2)
    r = buy(client, world, qty=2)
    assert r.status_code == 400 and "Plus que 1 place" in r.get_data(as_text=True)


def test_refused_payment_issues_nothing(client, world, db):
    buy(client, world)
    order = last_order(db)
    client.post(f"/paiement/simulation/{order.ref}", data={"decision": "refuse"})
    db.session.expire_all()
    assert last_order(db).status == "failed" and not last_order(db).tickets


def test_free_event_issues_immediately(client, world, db):
    world["ev_a"].categories[0].price = 0
    db.session.commit()
    r = buy(client, world, provider="")
    assert r.status_code == 302 and last_order(db).status == "paid"


# --- Wave ------------------------------------------------------------------------------------
@pytest.fixture
def wave(app, monkeypatch):
    app.config.update(WAVE_API_KEY="wave_sn_prod_test", WAVE_WEBHOOK_SECRET="wave_sn_WHS_secret")
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append((url, json, headers))
        return FakeResponse(200, {"id": "cos-123", "wave_launch_url": "https://pay.wave.com/c/cos-123",
                                  "checkout_status": "open"})
    monkeypatch.setattr("ticketsecure.payments.wave.requests.post", fake_post)
    monkeypatch.setattr("ticketsecure.payments.wave.requests.get",
                        lambda *a, **k: FakeResponse(200, {"checkout_status": "open", "payment_status": "processing"}))
    return calls


def wave_post(client, payload, secret="wave_sn_WHS_secret", ts=None):
    body = json.dumps(payload).encode()
    ts = str(ts or int(time.time()))
    sig = hmac.new(secret.encode(), ts.encode() + body, hashlib.sha256).hexdigest()
    return client.post("/webhooks/wave", data=body, content_type="application/json",
                       headers={"Wave-Signature": f"t={ts},v1={sig}"})


def wave_event(order, amount=None, eid="EV_1"):
    return {"id": eid, "type": "checkout.session.completed", "data": {
        "id": "cos-123", "amount": str(amount if amount is not None else order.amount), "currency": "XOF",
        "client_reference": order.ref, "payment_status": "succeeded", "checkout_status": "complete",
        "transaction_id": "TCN123"}}


def test_wave_checkout_and_signed_webhook(client, world, db, wave):
    r = buy(client, world, provider="wave")
    assert r.status_code == 303 and r.location == "https://pay.wave.com/c/cos-123"
    url, payload, headers = wave[0]
    assert url.endswith("/v1/checkout/sessions") and payload["amount"] == "10000"
    assert headers["Idempotency-Key"] == payload["client_reference"]
    order = last_order(db)
    assert order.provider_ref == "cos-123"

    assert wave_post(client, wave_event(order), secret="mauvais").status_code == 401
    assert wave_post(client, wave_event(order), ts=int(time.time()) - 3600).status_code == 401
    db.session.expire_all()
    assert last_order(db).status == "pending"

    assert wave_post(client, wave_event(order)).status_code == 200
    db.session.expire_all()
    order = last_order(db)
    assert order.status == "paid" and order.provider_txn == "TCN123" and len(order.tickets) == 2
    # Rejeu de la même notification : sans effet.
    assert wave_post(client, wave_event(order)).get_json()["duplicate"]
    assert db.session.scalar(db.select(db.func.count(Ticket.id))) == 2


def test_wave_amount_mismatch_rejected(client, world, db, wave):
    buy(client, world, provider="wave")
    order = last_order(db)
    wave_post(client, wave_event(order, amount=100, eid="EV_2"))
    db.session.expire_all()
    assert last_order(db).status == "pending"
    note = db.session.scalar(db.select(PaymentNotification))
    assert note.outcome == "rejected_amount"


def test_wave_provider_unavailable(client, world, db, app, monkeypatch):
    app.config.update(WAVE_API_KEY="k", WAVE_WEBHOOK_SECRET="s")
    import requests

    def boom(*a, **k):
        raise requests.ConnectionError("down")
    monkeypatch.setattr("ticketsecure.payments.wave.requests.post", boom)
    r = buy(client, world, provider="wave")
    assert r.status_code == 302
    assert last_order(db).status == "failed"


# --- Carte (Stripe Checkout) ------------------------------------------------------------------
def test_stripe_checkout_and_webhook(client, world, db, app, monkeypatch):
    app.config.update(STRIPE_SECRET_KEY="sk_test_x", STRIPE_WEBHOOK_SECRET="whsec_x")
    sent = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        sent.update(data)
        return FakeResponse(200, {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})
    monkeypatch.setattr("ticketsecure.payments.stripe_card.requests.post", fake_post)
    r = buy(client, world, provider="card")
    assert r.location.startswith("https://checkout.stripe.com/")
    assert sent["line_items[0][price_data][currency]"] == "xof"
    assert sent["line_items[0][price_data][unit_amount]"] == 5000  # devise sans décimale
    order = last_order(db)

    event = {"id": "evt_1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_test_1", "client_reference_id": order.ref, "amount_total": 10000, "currency": "xof",
        "payment_status": "paid", "status": "complete", "payment_intent": "pi_1"}}}
    body = json.dumps(event).encode()
    ts = str(int(time.time()))
    sig = hmac.new(b"whsec_x", ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    bad = client.post("/webhooks/stripe", data=body, content_type="application/json",
                      headers={"Stripe-Signature": f"t={ts},v1={'0' * 64}"})
    assert bad.status_code == 400
    ok = client.post("/webhooks/stripe", data=body, content_type="application/json",
                     headers={"Stripe-Signature": f"t={ts},v1={sig}"})
    assert ok.status_code == 200
    db.session.expire_all()
    assert last_order(db).status == "paid" and last_order(db).provider_txn == "pi_1"


# --- Orange Money -----------------------------------------------------------------------------
def test_orange_money_notification_double_checked(client, world, db, app, monkeypatch):
    app.config.update(ORANGE_CLIENT_ID="id", ORANGE_CLIENT_SECRET="secret", ORANGE_MERCHANT_KEY="mk",
                      ORANGE_COUNTRY="dev")
    from ticketsecure.payments import orange_money
    orange_money._token_cache.update(value=None, expires=0)
    state = {"status": "PENDING"}

    def fake_post(url, json=None, data=None, headers=None, timeout=None):
        if url.endswith("/oauth/v3/token"):
            return FakeResponse(200, {"access_token": "tok", "expires_in": 3600})
        if url.endswith("/webpayment"):
            assert json["currency"] == "OUV" and json["notif_url"].endswith(json["order_id"])
            return FakeResponse(201, {"status": 201, "pay_token": "pt_1", "notif_token": "nt_secret",
                                      "payment_url": "https://webpayment.orange.test/pay/pt_1"})
        if url.endswith("/transactionstatus"):
            return FakeResponse(201, {"status": state["status"], "txnid": "MP123"})
        raise AssertionError(url)
    monkeypatch.setattr("ticketsecure.payments.orange_money.requests.post", fake_post)

    r = buy(client, world, provider="orange_money")
    assert r.location == "https://webpayment.orange.test/pay/pt_1"
    order = last_order(db)
    assert order.provider_secret_hash and order.provider_secret_hash != "nt_secret"

    url = f"/webhooks/orange-money/{order.ref}"
    assert client.post(url, json={"status": "SUCCESS", "notif_token": "faux", "txnid": "MP123"}).status_code == 401
    # notif_token correct, mais l'API Orange ne confirme pas encore : rien n'est émis.
    assert client.post(url, json={"status": "SUCCESS", "notif_token": "nt_secret", "txnid": "MP123"}).status_code == 409
    db.session.expire_all()
    assert last_order(db).status == "pending"
    state["status"] = "SUCCESS"
    assert client.post(url, json={"status": "SUCCESS", "notif_token": "nt_secret", "txnid": "MP123"}).status_code == 200
    db.session.expire_all()
    assert last_order(db).status == "paid" and len(last_order(db).tickets) == 2


def test_admin_can_verify_lost_notification(client, world, db, wave, monkeypatch):
    from conftest import login
    buy(client, world, provider="wave")
    order = last_order(db)
    monkeypatch.setattr("ticketsecure.payments.wave.requests.get", lambda *a, **k: FakeResponse(200, {
        "id": "cos-123", "amount": "10000", "currency": "XOF", "payment_status": "succeeded",
        "checkout_status": "complete", "transaction_id": "TX9"}))
    staff = client.application.test_client()
    login(staff, "admin@a.test")
    staff.post(f"/espace/commandes/{order.id}/verifier")
    db.session.expire_all()
    assert last_order(db).status == "paid"
    assert staff.get("/espace/ventes").status_code == 200
    assert staff.get(f"/espace/commandes/{order.id}").status_code == 200
    assert "Net organisateur" in staff.get("/espace/ventes.csv").data.decode("utf-8-sig")
