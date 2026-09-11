"""Loopback-only OpenAI-compatible embeddings service; no cloud calls.

Run: .venv/Scripts/python.exe -m semantic_search.local_embedding_server
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import threading
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from semantic_search.local_embeddings import DIMENSION, LocalE5, MAX_BATCH, MAX_INPUT_CHARS, MODEL_ID


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Literal[MODEL_ID]
    input: Annotated[StrictStr, Field(min_length=1, max_length=MAX_INPUT_CHARS)] | Annotated[list[StrictStr], Field(min_length=1, max_length=41)]
    dimensions: Literal[DIMENSION] = DIMENSION
    encoding_format: Literal["float"] = "float"


def create_app(backend: LocalE5) -> FastAPI:
    app = FastAPI(title="ColleX local embeddings", docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    active = threading.BoundedSemaphore(1)

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).hostname not in ("localhost", "127.0.0.1"):
            return JSONResponse({"error": "Local origin required"}, status_code=403)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"status": "ready", "model": MODEL_ID, "dimension": DIMENSION, "local": True}

    @app.post("/v1/embeddings")
    def embeddings(body: EmbeddingRequest):
        texts = [body.input] if isinstance(body.input, str) else body.input
        if not texts or any(not text.strip() or len(text) > MAX_INPUT_CHARS for text in texts):
            raise HTTPException(422, "Empty or oversized embedding input")
        if not active.acquire(blocking=False):
            raise HTTPException(429, "Local embedding worker busy; retry later")
        try:
            vectors = []
            for start in range(0, len(texts), MAX_BATCH):
                vectors.extend(backend.embed(texts[start:start + MAX_BATCH]))
        except Exception:
            raise HTTPException(503, "Local embedding calculation failed") from None
        finally:
            active.release()
        return {
            "object": "list", "model": MODEL_ID,
            "data": [{"object": "embedding", "index": index, "embedding": vector} for index, vector in enumerate(vectors)],
        }

    return app


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8898)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parents[1] / "var/models/multilingual-e5-small")
    parser.add_argument("--parent-stdin", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--collex-managed", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    backend = LocalE5(args.model_dir)
    if args.parent_stdin:
        def stop_when_parent_closes() -> None:
            try:
                sys.stdin.buffer.read()
            finally:
                # A hard-killed Node parent runs no exit hooks. Closing the
                # pipe is the reliable Windows lifecycle signal; do not leave
                # a model process listening after ColleX has gone away.
                os._exit(0)
        threading.Thread(target=stop_when_parent_closes, daemon=True).start()
    # No --host override: this service never binds a public interface.
    uvicorn.run(create_app(backend), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
