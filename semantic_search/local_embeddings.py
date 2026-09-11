"""Offline, CPU-only E5 embeddings over pinned ONNX model data.

Setup is explicit: scripts/prepare_local_embeddings.py downloads data; this
module never downloads anything and never executes model repository Python.
The caller supplies E5's query:/passage: prefix (as the existing clients do).
"""
from __future__ import annotations

from pathlib import Path
import threading

import numpy as np

from semantic_search.local_embedding_assets import FILES, digest

MODEL_ID = "intfloat/multilingual-e5-small:onnx-qint8"
DIMENSION = 384
MAX_BATCH = 16
MAX_INPUT_CHARS = 32000


def masked_mean_normalize(hidden: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if hidden.ndim != 3 or mask.shape != hidden.shape[:2]:
        raise ValueError("Invalid embedding output shape")
    weights = mask.astype(np.float32)[..., None]
    counts = weights.sum(axis=1)
    if np.any(counts <= 0):
        raise ValueError("Empty embedding token mask")
    pooled = (hidden.astype(np.float32) * weights).sum(axis=1) / counts
    norms = np.linalg.norm(pooled, axis=1, keepdims=True)
    if not np.all(np.isfinite(pooled)) or not np.all(np.isfinite(norms)) or np.any(norms <= 0):
        raise ValueError("Invalid embedding values")
    return pooled / norms


class LocalE5:
    def __init__(self, model_dir: str | Path):
        root = Path(model_dir)
        for name, size, expected in FILES:
            path = root / name
            if not path.is_file() or path.stat().st_size != size or digest(path) != expected:
                raise ValueError(f"Local embedding asset missing or integrity check failed: {name}")
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.tokenizer = Tokenizer.from_file(str(root / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(root / FILES[0][0]), sess_options=options, providers=["CPUExecutionProvider"],
        )
        self.lock = threading.Lock()

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts or len(texts) > MAX_BATCH:
            raise ValueError(f"Embedding batch must contain 1–{MAX_BATCH} texts")
        if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_INPUT_CHARS for text in texts):
            raise ValueError("Embedding text is empty or exceeds the input limit")
        with self.lock:
            encoded = self.tokenizer.encode_batch(texts)
            inputs = {
                "input_ids": np.asarray([entry.ids for entry in encoded], dtype=np.int64),
                "attention_mask": np.asarray([entry.attention_mask for entry in encoded], dtype=np.int64),
                "token_type_ids": np.asarray([entry.type_ids for entry in encoded], dtype=np.int64),
            }
            hidden = self.session.run(["last_hidden_state"], inputs)[0]
            vectors = masked_mean_normalize(hidden, inputs["attention_mask"])
        if vectors.shape != (len(texts), DIMENSION):
            raise ValueError("Unexpected embedding dimension")
        return vectors.tolist()
