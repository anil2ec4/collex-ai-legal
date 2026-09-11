"""Semantic reranking for UYAP Emsal search candidates."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Iterable, List

from semantic_search.embedder import get_embedder
from semantic_search.processor import DocumentProcessor
from semantic_search.vector_store import VectorStore


logger = logging.getLogger(__name__)


async def rerank_emsal_decisions(
    client: Any,
    decisions: Iterable[Any],
    query: str,
    top_k: int,
) -> Dict[str, Any]:
    """Fetch candidate texts sequentially and rerank them by cosine similarity.

    Candidate retrieval remains the official UYAP keyword/filter search.  Only
    the ten results on the requested page are fetched, one at a time, so this
    helper does not create a burst against the government endpoint.
    """
    processor = DocumentProcessor(chunk_size=1500, chunk_overlap=250)
    documents: List[Dict[str, Any]] = []
    failed = 0

    for decision in list(decisions)[:10]:
        try:
            document = await client.get_decision_document_as_markdown(decision.id)
            if not document.markdown_content:
                failed += 1
                continue

            chunks = processor.process_document(
                document_id=decision.id,
                text=document.markdown_content,
                metadata={
                    "daire": decision.daire,
                    "esas_no": decision.esasNo,
                    "karar_no": decision.kararNo,
                    "karar_tarihi": decision.kararTarihi,
                },
            )
            text = " ".join(chunk.text for chunk in chunks)[:6000]
            if not text:
                failed += 1
                continue

            documents.append(
                {
                    "id": decision.id,
                    "text": text,
                    "title": f"{decision.daire} {decision.esasNo} {decision.kararNo}",
                    "decision": decision.model_dump(mode="json"),
                }
            )
        except Exception as exc:
            failed += 1
            logger.warning("Could not prepare Emsal document %s: %s", decision.id, exc)
            if hasattr(exc, "retry_after"):
                break

    if not documents:
        return {
            "results": [],
            "processed": 0,
            "failed": failed,
            "error": "No Emsal candidate documents could be prepared for semantic search.",
        }

    embedder = get_embedder()
    texts = [item["text"] for item in documents]
    titles = [item["title"] for item in documents]
    query_embedding, document_embeddings = await asyncio.gather(
        asyncio.to_thread(embedder.encode_query, query, "legal decision retrieval"),
        asyncio.to_thread(embedder.encode_documents, texts, titles),
    )

    store = VectorStore(dimension=embedder.dimension)
    store.add_documents(
        ids=[item["id"] for item in documents],
        texts=texts,
        embeddings=document_embeddings,
        metadata=[{"decision": item["decision"]} for item in documents],
    )

    ranked = []
    for document, score in store.search(
        query_embedding=query_embedding,
        top_k=min(top_k, len(documents)),
    ):
        decision = dict(document.metadata["decision"])
        decision["semantic_score"] = round(float(score), 6)
        decision["semantic_preview"] = (
            document.text[:500] + "..." if len(document.text) > 500 else document.text
        )
        ranked.append(decision)

    return {
        "results": ranked,
        "processed": len(documents),
        "failed": failed,
        "embedding_model": embedder.model,
        "embedding_dimension": embedder.dimension,
    }
