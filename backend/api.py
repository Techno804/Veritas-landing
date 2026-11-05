"""
Veritas API: espone FactChecker (fact_checker.py) via HTTP per il frontend.

Avvio in locale (dalla cartella backend/, con fever_delivery/ accanto):
    pip install -r requirements.txt
    python api.py

Endpoint:
    GET  /api/health  -> stato del servizio
    POST /api/check   -> {"claim": "...", "k": 3}  ->  FactCheckResult (JSON)

Variabili d'ambiente opzionali:
    VERITAS_HOST             default 127.0.0.1 (usa 0.0.0.0 su un server)
    VERITAS_PORT             default 8000
    VERITAS_DATA_DIR         cartella con corpus_large.csv e faiss_index_large.bin
    VERITAS_MODEL_DIR        cartella con il modello fine-tuned
    VERITAS_DEVICE           "cpu" o "cuda" (default: automatico)
    VERITAS_ALLOWED_ORIGINS  origini ammesse dal browser, separate da virgola
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from flask import Flask, jsonify, request

MAX_CLAIM_CHARS = 300
MAX_K = 10
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5500,http://127.0.0.1:5500,"
    "http://localhost:8080,http://127.0.0.1:8080,"
    "https://techno804.github.io"
)

log = logging.getLogger("veritas.api")


def _error(status: int, code: str, message: str):
    return jsonify({"error": {"code": code, "message": message}}), status


def _load_checker() -> Any:
    from fact_checker import FactChecker

    started = time.perf_counter()
    checker = FactChecker.from_pretrained(
        data_dir=os.environ.get("VERITAS_DATA_DIR") or None,
        model_dir=os.environ.get("VERITAS_MODEL_DIR") or None,
        device=os.environ.get("VERITAS_DEVICE") or None,
    )
    log.info("Modello caricato in %.1fs", time.perf_counter() - started)
    return checker


def create_app(checker: Any | None = None) -> Flask:
    """Crea l'app. Se ``checker`` è None carica il modello vero (richiede i file pesanti)."""
    app = Flask(__name__)
    app.json.ensure_ascii = False  # accenti e simboli IPA leggibili nel JSON

    checker = checker if checker is not None else _load_checker()
    inference_lock = threading.Lock()  # un claim alla volta: evita di saturare la CPU
    allowed_origins = {
        origin.strip()
        for origin in os.environ.get("VERITAS_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
        if origin.strip()
    }

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin and (origin in allowed_origins or "*" in allowed_origins):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
        return response

    @app.get("/api/health")
    def health():
        corpus = getattr(checker, "_corpus", None)
        return jsonify(
            {
                "status": "ok",
                "corpus_size": len(corpus) if corpus is not None else None,
                "device": getattr(checker, "_device", None),
                "max_claim_chars": MAX_CLAIM_CHARS,
            }
        )

    @app.post("/api/check")
    def check():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error(400, "invalid_json", "Il corpo della richiesta deve essere un oggetto JSON.")

        claim = payload.get("claim")
        if not isinstance(claim, str) or not claim.strip():
            return _error(422, "invalid_claim", "Scrivi un'affermazione da verificare.")
        claim = claim.strip()
        if len(claim) > MAX_CLAIM_CHARS:
            return _error(
                422, "claim_too_long", f"L'affermazione supera i {MAX_CLAIM_CHARS} caratteri."
            )

        k = payload.get("k")
        if k is not None and (isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= MAX_K):
            return _error(422, "invalid_k", f"k deve essere un intero tra 1 e {MAX_K}.")

        started = time.perf_counter()
        try:
            with inference_lock:
                result = checker.classify_claim(claim, k=k)
        except ValueError as error:
            return _error(422, "invalid_request", str(error))
        except Exception:  # noqa: BLE001 - non esporre dettagli interni al browser
            log.exception("Errore durante la verifica del claim")
            return _error(500, "internal_error", "Errore interno durante la verifica.")

        # Nel log niente testo delle frasi: potrebbero contenere dati personali.
        log.info("%s (%.0f ms)", result["predicted_label"], (time.perf_counter() - started) * 1000)
        return jsonify(result)

    @app.errorhandler(404)
    def not_found(_):
        return _error(404, "not_found", "Endpoint inesistente.")

    @app.errorhandler(405)
    def method_not_allowed(_):
        return _error(405, "method_not_allowed", "Metodo non consentito.")

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    application = create_app()
    application.run(
        host=os.environ.get("VERITAS_HOST", "127.0.0.1"),
        port=int(os.environ.get("VERITAS_PORT", "8000")),
        threaded=True,
    )
