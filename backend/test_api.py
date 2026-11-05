"""
Test dell'API senza i file pesanti (modello e indice FAISS).

Usa la vera logica di FactChecker.classify_claim, sostituendo solo il retrieval
e il modello NLI con valori fissi presi dall'output del notebook demo.
Avvio:  python test_api.py
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd

from api import create_app
from fact_checker import FactChecker

CORPUS = [
    "[Earth's orbit] Viewed from a vantage point above the north poles of both the Sun and "
    "the Earth , the Earth would appear to revolve in a counterclockwise direction about the Sun .",
    "[Earth's orbit] Earth 's orbit is the path through which the Earth travels around the Sun .",
    "[Earth's orbit] From the same vantage point , both the Earth and the Sun would appear to "
    "rotate in a counterclockwise direction about their respective axes .",
    "[Pizza] Pizza is a traditional Italian dish .",
]
# Probabilità [SUPPORTS, REFUTES, NOT ENOUGH INFO] per frase, dal notebook (cella 9).
SCORES = {
    0: [0.7934, 0.1117, 0.0949],
    1: [0.8539, 0.0791, 0.0670],
    2: [0.6655, 0.1960, 0.1385],
    3: [0.0100, 0.0200, 0.9700],
}


class StubChecker(FactChecker):
    """FactChecker vero con retrieval e NLI finti."""

    def retrieve_top_k(self, claim, k=5):
        rows = [0, 1, 2] if "earth" in claim.lower() else [3]
        rows = (rows + [-1] * k)[:k]
        return np.zeros(k, dtype="float32"), np.array(rows)

    def _score_evidence(self, claim, evidence_texts):
        return [SCORES[CORPUS.index(text)] for text in evidence_texts]


def build_checker() -> StubChecker:
    labels = {0: "SUPPORTS", 1: "REFUTES", 2: "NOT ENOUGH INFO"}
    classifier = SimpleNamespace(
        config=SimpleNamespace(id2label=labels, label2id={v: k for k, v in labels.items()})
    )
    return StubChecker(
        corpus=pd.DataFrame({"text": CORPUS}),
        faiss_index=SimpleNamespace(ntotal=len(CORPUS)),
        retriever=None,
        classifier=classifier,
        tokenizer=None,
        device="cpu",
    )


def main() -> None:
    client = create_app(build_checker()).test_client()
    origin = {"Origin": "http://localhost:5500"}

    health = client.get("/api/health", headers=origin)
    assert health.status_code == 200 and health.json["corpus_size"] == len(CORPUS)
    assert health.headers["Access-Control-Allow-Origin"] == "http://localhost:5500"

    preflight = client.options("/api/check", headers={**origin, "Access-Control-Request-Method": "POST"})
    assert preflight.status_code == 200 and "POST" in preflight.headers["Access-Control-Allow-Methods"]

    blocked = client.get("/api/health", headers={"Origin": "https://sito-sconosciuto.example"})
    assert "Access-Control-Allow-Origin" not in blocked.headers

    ok = client.post("/api/check", json={"claim": "  The Earth revolves around the Sun. ", "k": 3})
    body = ok.json
    assert ok.status_code == 200, body
    assert body["claim"] == "The Earth revolves around the Sun."
    assert body["predicted_label"] == "SUPPORTS" and not body["abstained"]
    assert abs(body["confidence"] - 0.8539) < 1e-9
    assert body["evidence_used"] == [CORPUS[1]]  # solo la frase sopra soglia, come nel notebook
    assert len(body["evidence_scores"]) == 3

    nei = client.post("/api/check", json={"claim": "My name is John."}).json
    assert nei["predicted_label"] == "NOT ENOUGH INFO" and nei["abstained"]
    assert nei["abstention_reason"].startswith("Self-referential")

    irrelevant = client.post("/api/check", json={"claim": "Volcanoes erupt lava."}).json
    assert irrelevant["abstention_reason"].startswith("Retrieved passages did not contain")

    for payload, status, code in [
        ({"claim": ""}, 422, "invalid_claim"),
        ({"claim": "x" * 301}, 422, "claim_too_long"),
        ({"claim": "Earth", "k": 0}, 422, "invalid_k"),
        ({"claim": "Earth", "k": True}, 422, "invalid_k"),
    ]:
        response = client.post("/api/check", json=payload)
        assert response.status_code == status and response.json["error"]["code"] == code, response.json

    bad_json = client.post("/api/check", data="non json", content_type="application/json")
    assert bad_json.status_code == 400 and bad_json.json["error"]["code"] == "invalid_json"
    assert client.get("/api/nope").status_code == 404
    assert client.get("/api/check").status_code == 405

    print("Tutti i test dell'API sono passati.")


if __name__ == "__main__":
    main()
