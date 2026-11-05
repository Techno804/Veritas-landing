"""
Reusable FEVER-style fact checking with retrieval and NLI classification.

The default asset layout is ``fever_delivery/data`` and ``fever_delivery/model``
under this file's directory. Run ``python fact_checker.py --claim "..."`` for
a command-line prediction, or use :class:`FactChecker` from another module.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict


_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+")
_PERSONAL_CLAIM_PATTERN = re.compile(
    r"^(my|i)\s+(name|full name|birth name)\s+is\s+.+$", re.IGNORECASE
)
_STOP_WORDS = frozenset(
    {
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
        "of", "in", "on", "at", "for", "to", "from", "by", "with", "and",
        "or", "if", "then", "it", "its", "this", "that", "these", "those",
        "my", "i", "me", "we", "our", "you", "your", "he", "she", "they",
    }
)
_REQUIRED_LABELS = ("SUPPORTS", "REFUTES", "NOT ENOUGH INFO")


EvidenceScore = TypedDict(
    "EvidenceScore",
    {
        "text": str,
        "SUPPORTS": float,
        "REFUTES": float,
        "NOT ENOUGH INFO": float,
    },
)


class FactCheckResult(TypedDict):
    """Result format returned by :meth:`FactChecker.classify_claim`."""

    claim: str
    predicted_label: str
    confidence: float
    evidence_used: list[str]
    evidence_scores: list[EvidenceScore]
    abstained: bool
    abstention_reason: str | None


@dataclass(frozen=True)
class FactCheckerConfig:
    """Inference thresholds and batching settings."""

    default_k: int = 3
    evidence_threshold: float = 0.80
    min_direction_margin: float = 0.15
    relevance_threshold: float = 0.1
    batch_size: int = 32
    max_length: int = 256

    def __post_init__(self) -> None:
        for name, value in (
            ("default_k", self.default_k),
            ("batch_size", self.batch_size),
            ("max_length", self.max_length),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        for name, value in (
            ("evidence_threshold", self.evidence_threshold),
            ("min_direction_margin", self.min_direction_margin),
            ("relevance_threshold", self.relevance_threshold),
        ):
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not 0.0 <= value <= 1.0
            ):
                raise ValueError(f"{name} must be between 0 and 1")


class FactChecker:
    """Retrieve evidence and classify whether it supports or refutes a claim.

    Use :meth:`from_pretrained` to load the delivery bundle. Predictions use
    the notebook's conservative rule: a SUPPORTS or REFUTES decision requires
    a sentence above the probability threshold and ahead of the opposing class
    by the configured margin. Otherwise, the checker abstains.
    """

    def __init__(
        self,
        *,
        corpus: Any,
        faiss_index: Any,
        retriever: Any,
        classifier: Any,
        tokenizer: Any,
        device: str,
        config: FactCheckerConfig | None = None,
    ) -> None:
        self._corpus = corpus
        self._faiss_index = faiss_index
        self._retriever = retriever
        self._classifier = classifier
        self._tokenizer = tokenizer
        self._device = device
        self.config = config or FactCheckerConfig()

        if "text" not in corpus.columns:
            raise ValueError("The corpus must contain a 'text' column")
        if len(corpus) != faiss_index.ntotal:
            raise ValueError(
                "Corpus and FAISS index sizes differ "
                f"({len(corpus)} rows versus {faiss_index.ntotal} vectors)"
            )
        if corpus["text"].isna().any():
            raise ValueError("The corpus 'text' column must not contain missing values")

        label2id = classifier.config.label2id
        id2label = classifier.config.id2label
        missing_labels = [label for label in _REQUIRED_LABELS if label not in label2id]
        if missing_labels:
            raise ValueError(
                "Classifier is missing required labels: " + ", ".join(missing_labels)
            )
        self._label_ids = {label: int(label2id[label]) for label in _REQUIRED_LABELS}
        self._label_names = {int(index): name for index, name in id2label.items()}
        if any(index not in self._label_names for index in self._label_ids.values()):
            raise ValueError("Classifier id2label and label2id mappings are inconsistent")

    @classmethod
    def from_pretrained(
        cls,
        data_dir: str | Path | None = None,
        model_dir: str | Path | None = None,
        *,
        retriever_model_name: str = "all-MiniLM-L6-v2",
        device: str | None = None,
        config: FactCheckerConfig | None = None,
    ) -> FactChecker:
        """Load the corpus, FAISS index, retriever, and fine-tuned NLI model."""
        try:
            import faiss
            import pandas as pd
            import torch
            from sentence_transformers import SentenceTransformer
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as error:
            raise ImportError(
                "FactChecker requires faiss, pandas, torch, sentence-transformers, "
                "and transformers. Install the packages used by the demo notebook."
            ) from error

        bundle_dir = Path(__file__).resolve().parent / "fever_delivery"
        resolved_data_dir = Path(data_dir) if data_dir is not None else bundle_dir / "data"
        resolved_model_dir = Path(model_dir) if model_dir is not None else bundle_dir / "model"
        selected_device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        corpus = pd.read_csv(resolved_data_dir / "corpus_large.csv")
        faiss_index = faiss.read_index(str(resolved_data_dir / "faiss_index_large.bin"))
        retriever = SentenceTransformer(retriever_model_name, device=selected_device)
        classifier = AutoModelForSequenceClassification.from_pretrained(
            str(resolved_model_dir)
        ).to(selected_device)
        tokenizer = AutoTokenizer.from_pretrained(str(resolved_model_dir))
        classifier.eval()

        return cls(
            corpus=corpus,
            faiss_index=faiss_index,
            retriever=retriever,
            classifier=classifier,
            tokenizer=tokenizer,
            device=selected_device,
            config=config,
        )

    @staticmethod
    def _normalize_claim_tokens(text: str) -> set[str]:
        return {
            token.lower()
            for token in _TOKEN_PATTERN.findall(text)
            if token.lower() not in _STOP_WORDS and len(token) > 2
        }

    @classmethod
    def _evidence_relevance_score(cls, claim: str, evidence_text: str) -> float:
        claim_tokens = cls._normalize_claim_tokens(claim)
        if not claim_tokens:
            return 0.0
        evidence_tokens = cls._normalize_claim_tokens(evidence_text)
        return len(claim_tokens & evidence_tokens) / len(claim_tokens)

    def retrieve_top_k(self, claim: str, k: int = 5) -> tuple[Any, Any]:
        """Return FAISS similarity scores and corpus row indices."""
        self._validate_claim(claim)
        self._validate_k(k)
        query_vector = self._retriever.encode(
            [claim],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype("float32")
        scores, indices = self._faiss_index.search(query_vector, k)
        return scores[0], indices[0]

    def _score_evidence(self, claim: str, evidence_texts: list[str]) -> list[list[float]]:
        import torch
        import torch.nn.functional as functional

        probabilities: list[list[float]] = []
        for start in range(0, len(evidence_texts), self.config.batch_size):
            batch = evidence_texts[start : start + self.config.batch_size]
            inputs = self._tokenizer(
                batch,
                [claim] * len(batch),
                truncation=True,
                max_length=self.config.max_length,
                padding=True,
                return_tensors="pt",
            ).to(self._device)
            with torch.no_grad():
                logits = self._classifier(**inputs).logits
                batch_probabilities = functional.softmax(logits, dim=-1)
            probabilities.extend(batch_probabilities.cpu().tolist())
        return probabilities

    @staticmethod
    def _abstention_result(
        claim: str,
        reason: str,
        confidence: float,
    ) -> FactCheckResult:
        return {
            "claim": claim,
            "predicted_label": "NOT ENOUGH INFO",
            "confidence": confidence,
            "evidence_used": [],
            "evidence_scores": [],
            "abstained": True,
            "abstention_reason": reason,
        }

    @staticmethod
    def _validate_claim(claim: str) -> None:
        if not isinstance(claim, str) or not claim.strip():
            raise ValueError("claim must be a non-empty string")

    @staticmethod
    def _validate_k(k: int) -> None:
        if isinstance(k, bool) or not isinstance(k, int) or k < 1:
            raise ValueError("k must be a positive integer")

    def classify_claim(
        self,
        claim: str,
        k: int | None = None,
        evidence_threshold: float | None = None,
        min_direction_margin: float | None = None,
    ) -> FactCheckResult:
        """Classify a claim and return its prediction, confidence, and evidence.

        ``confidence`` is the notebook's decision score, not a calibrated
        probability. Custom thresholds are validated for each call.
        """
        self._validate_claim(claim)
        claim = claim.strip()
        selected_k = self.config.default_k if k is None else k
        self._validate_k(selected_k)
        selected_threshold = (
            self.config.evidence_threshold
            if evidence_threshold is None
            else evidence_threshold
        )
        selected_margin = (
            self.config.min_direction_margin
            if min_direction_margin is None
            else min_direction_margin
        )
        for name, value in (
            ("evidence_threshold", selected_threshold),
            ("min_direction_margin", selected_margin),
        ):
            if not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1")

        if _PERSONAL_CLAIM_PATTERN.match(claim):
            return self._abstention_result(
                claim,
                "Self-referential personal claims are not reliably verifiable in the corpus",
                0.0,
            )

        _, indices = self.retrieve_top_k(claim, k=selected_k)
        valid_indices = indices[indices >= 0]
        if len(valid_indices) == 0:
            return self._abstention_result(claim, "No evidence was retrieved", 1.0)

        evidence_texts = [
            str(text)
            for text in self._corpus.iloc[valid_indices]["text"].tolist()
            if self._evidence_relevance_score(claim, str(text))
            >= self.config.relevance_threshold
        ]
        if not evidence_texts:
            return self._abstention_result(
                claim,
                "Retrieved passages did not contain enough relevant context for the claim",
                1.0,
            )

        evidence_probabilities = self._score_evidence(claim, evidence_texts)
        supports_id = self._label_ids["SUPPORTS"]
        refutes_id = self._label_ids["REFUTES"]
        nei_id = self._label_ids["NOT ENOUGH INFO"]
        max_support = max(row[supports_id] for row in evidence_probabilities)
        max_refute = max(row[refutes_id] for row in evidence_probabilities)
        support_strong = max_support >= selected_threshold
        refute_strong = max_refute >= selected_threshold

        abstention_reason: str | None = None
        if support_strong and refute_strong:
            prediction_id = nei_id
            abstention_reason = "Strong evidence supports both labels"
        elif support_strong and max_support - max_refute >= selected_margin:
            prediction_id = supports_id
        elif refute_strong and max_refute - max_support >= selected_margin:
            prediction_id = refutes_id
        else:
            prediction_id = nei_id
            abstention_reason = (
                "No sentence provided sufficiently strong directional evidence"
            )

        evidence_used: list[str] = []
        if prediction_id in (supports_id, refutes_id):
            opposite_id = refutes_id if prediction_id == supports_id else supports_id
            evidence_used = [
                text
                for text, probabilities in zip(
                    evidence_texts, evidence_probabilities, strict=True
                )
                if probabilities[prediction_id] >= selected_threshold
                and probabilities[prediction_id] - probabilities[opposite_id]
                >= selected_margin
            ]

        confidence = (
            max_support
            if prediction_id == supports_id
            else max_refute
            if prediction_id == refutes_id
            else max(0.0, 1.0 - max(max_support, max_refute))
        )
        return {
            "claim": claim,
            "predicted_label": self._label_names[prediction_id],
            "confidence": float(confidence),
            "evidence_used": evidence_used,
            "evidence_scores": [
                {
                    "text": text,
                    "SUPPORTS": float(probabilities[supports_id]),
                    "REFUTES": float(probabilities[refutes_id]),
                    "NOT ENOUGH INFO": float(probabilities[nei_id]),
                }
                for text, probabilities in zip(
                    evidence_texts, evidence_probabilities, strict=True
                )
            ],
            "abstained": prediction_id == nei_id,
            "abstention_reason": abstention_reason,
        }


def main() -> None:
    """Run a single fact check from the command line."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claim", required=True, help="Claim to fact-check")
    parser.add_argument("--k", type=int, default=3, help="Number of passages to retrieve")
    parser.add_argument("--data-dir", type=Path, help="Directory containing corpus and FAISS index")
    parser.add_argument("--model-dir", type=Path, help="Directory containing the fine-tuned model")
    parser.add_argument("--device", help="Inference device, for example 'cpu' or 'cuda'")
    args = parser.parse_args()

    checker = FactChecker.from_pretrained(
        data_dir=args.data_dir,
        model_dir=args.model_dir,
        device=args.device,
    )
    result = checker.classify_claim(args.claim, k=args.k)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
