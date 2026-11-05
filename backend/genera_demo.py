"""
Genera mock-data.js con le risposte VERE del modello, per la modalità demo del sito.

Va lanciato da chi ha la cartella fever_delivery/ completa (con i file pesanti):
    cd backend
    python genera_demo.py

Stampa il verdetto di ogni frase e riscrive ../mock-data.js. Da quel momento la demo
(senza server) mostra tutti i post del feed e gli esempi con i risultati reali.
Per cambiare i post, modifica anche POSTS in app.js: le frasi devono coincidere.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

# Frasi dei post del feed (app.js → POSTS) seguite dagli esempi di "Verifica tu".
CLAIMS = [
    "The Earth revolves around the Sun.",
    "The Sun revolves around the Earth.",
    "Penicillin was discovered by Alexander Fleming.",
    "Albert Einstein secretly disliked the taste of coffee.",
    "Marie Curie won two Nobel Prizes.",
    "The Eiffel Tower is located in Berlin.",
    # esempi per "Verifica tu"
    "Paris is the capital of France.",
    "Paris is the capital of Berlin.",
    "Paris is the capital of Germany.",
]

OUTPUT = Path(__file__).resolve().parent.parent / "mock-data.js"


def generate(checker: Any, claims: Iterable[str], output: Path = OUTPUT, k: int = 3) -> list[dict]:
    results = []
    for claim in claims:
        result = checker.classify_claim(claim, k=k)
        print(f"{result['predicted_label']:<16} {result['confidence']:6.1%}  {claim}")
        results.append(result)
    output.write_text(
        "// Generato da backend/genera_demo.py: risposte reali del modello (non modificare a mano).\n"
        "window.VERITAS_MOCKS = " + json.dumps(results, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"\nScritto {output} ({len(results)} frasi).")
    return results


if __name__ == "__main__":
    from fact_checker import FactChecker

    generate(FactChecker.from_pretrained(), CLAIMS)
