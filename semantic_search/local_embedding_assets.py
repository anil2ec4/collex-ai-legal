"""Pinned official E5 model assets, verified from the publisher on 2026-09-09."""
import hashlib
from pathlib import Path

REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
BASE = f"https://huggingface.co/intfloat/multilingual-e5-small/resolve/{REVISION}/onnx/"
FILES = (
    ("model_qint8_avx512_vnni.onnx", 118346824, "dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88"),
    ("tokenizer.json", 17082730, "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"),
)


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()
