"""Download pinned, hash-verified model DATA for offline E5 inference.

No model repository code is executed. Run with the repository venv Python.
Only this explicit setup command contacts the model host; inference is offline.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import tempfile
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from semantic_search.local_embedding_assets import BASE, FILES, digest  # noqa: E402


def prepare(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, size, expected in FILES:
        target = directory / name
        if target.is_file() and target.stat().st_size == size and digest(target) == expected:
            print(f"verified existing: {name}", flush=True)
            continue
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix="download-", suffix=".part", delete=False) as output:
                temporary = Path(output.name)
                received = 0
                with urlopen(BASE + name, timeout=60) as response:
                    while block := response.read(1024 * 1024):
                        received += len(block)
                        if received > size:
                            raise ValueError(f"Unexpected size: {name}")
                        output.write(block)
            if received != size or digest(temporary) != expected:
                raise ValueError(f"Integrity check failed: {name}")
            os.replace(temporary, target)
            print(f"downloaded and verified: {name} ({size} bytes)", flush=True)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parents[1] / "var/models/multilingual-e5-small")
    prepare(parser.parse_args().model_dir)
