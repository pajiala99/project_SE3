"""FastAPI contract test — the exact HTTP surface the Node backend uses."""

from fastapi.testclient import TestClient

from app import app
from conftest import NOW, make_donation, make_request, standard_recipients

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_match_run_greedy_over_http():
    req = make_request([make_donation("d1")], standard_recipients())
    res = client.post("/match/run", json=req.model_dump(mode="json"))
    assert res.status_code == 200
    body = res.json()
    assert body["strategy"] == "greedy"
    assert body["assignments"][0]["recipientId"] == "rec-hope"
    assert body["assignments"][0]["urgencyScore"] > 0
    assert body["explanations"][0]["candidates"]


def test_match_run_hungarian_over_http():
    req = make_request([make_donation("d1")], standard_recipients(), strategy="hungarian")
    res = client.post("/match/run", json=req.model_dump(mode="json"))
    assert res.status_code == 200
    assert res.json()["strategy"] == "hungarian"
    assert res.json()["assignments"][0]["recipientId"] == "rec-hope"


def test_match_run_rejects_bad_payload():
    res = client.post("/match/run", json={"donations": [], "recipients": []})
    assert res.status_code == 422  # pydantic validation (missing 'now')
