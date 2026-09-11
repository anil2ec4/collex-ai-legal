"""Offline ranking probe over the previously inspected public decision sample.

This small, agent-selected sample is NOT an independent legal-quality benchmark.
"""
from pathlib import Path
import argparse
import json
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_search.local_embeddings import LocalE5, MODEL_ID  # noqa: E402
import numpy as np  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--windowed", action="store_true")
    options = parser.parse_args()
    folder = ROOT / "var/audit-20260907"
    samples = json.loads((folder / "query-precision-fulltexts.json").read_text(encoding="utf-8-sig"))
    query = "Fazla çalışmanın tanıkla ispatı ve işveren kayıtları yönünden Yargıtay kararları"
    started = time.perf_counter()
    model = LocalE5(ROOT / "var/models/multilingual-e5-small")
    load_ms = (time.perf_counter() - started) * 1000
    started = time.perf_counter()
    best_windows = {}
    if options.windowed:
        query_vector = np.asarray(model.embed(["query: " + query])[0])
        windows = [
            (index, start, item["card"]["text"][start:start + 1200])
            for index, item in enumerate(samples)
            for start in range(0, len(item["card"]["text"]), 900)
            if len(item["card"]["text"][start:start + 1200].strip()) >= 80
        ]
        scores = np.full(len(samples), -1.0)
        for offset in range(0, len(windows), 16):
            batch = windows[offset:offset + 16]
            vectors = np.asarray(model.embed(["passage: " + text for _, _, text in batch]))
            for (index, start, text), score in zip(batch, vectors @ query_vector, strict=True):
                if score > scores[index]:
                    scores[index] = score
                    best_windows[samples[index]["row"]["externalId"]] = {"start": start, "text": text}
    else:
        vectors = np.asarray(model.embed(["query: " + query] + ["passage: " + item["card"]["text"][:8000] for item in samples]))
        scores = vectors[1:] @ vectors[0]
    ranked = sorted([
        {"externalId": item["row"]["externalId"], "title": item["row"]["title"], "score": float(score)}
        for item, score in zip(samples, scores, strict=True)
    ], key=lambda item: -item["score"])
    report = {
        "model": MODEL_ID, "query": query, "loadMs": round(load_ms, 1),
        "inferenceMs": round((time.perf_counter() - started) * 1000, 1),
        "count": len(samples), "ranking": ranked,
        "windowed": options.windowed,
        "bestWindows": best_windows,
        "limitation": "Previously inspected, agent-selected sample; not blinded or lawyer-adjudicated. " + (
            "1200-character overlapping windows over the full document, max window similarity; each input capped at 512 model tokens."
            if options.windowed else "Input head capped at 8000 characters and 512 model tokens."
        ),
    }
    filename = "local-semantic-window-probe.json" if options.windowed else "local-semantic-probe.json"
    (folder / filename).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "bestWindows"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
