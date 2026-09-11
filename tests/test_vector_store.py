# tests/test_vector_store.py
"""Regression: threshold=0.0 must behave as an explicit similarity threshold.

Both in-memory vector stores filtered candidates with 'threshold is not None'
but re-indexed results with bare 'if threshold' truthiness. A caller passing
threshold=0.0 (drop negative-similarity docs) therefore applied indices that
were only valid in the FILTERED similarity array to the ORIGINAL unfiltered
document list — silently returning the wrong documents. Both branches now use
'threshold is not None'.
"""

import numpy as np
import pytest

from mevzuat_semantic_search.vector_store import VectorStore as MevzuatVectorStore
from semantic_search.vector_store import VectorStore as CourtVectorStore


def _populated(store):
    # Query will be [1, 0]:
    #   'neg'  -> similarity -1.0 (dropped by threshold=0.0)
    #   'mid'  -> similarity  0.6
    #   'best' -> similarity  1.0
    embeddings = np.array(
        [[-1.0, 0.0], [0.6, 0.8], [1.0, 0.0]], dtype=np.float32
    )
    store.add_documents(
        ids=["neg", "mid", "best"],
        texts=["negative match", "middle match", "best match"],
        embeddings=embeddings,
        metadata=[{}, {}, {}],
    )
    return store


@pytest.mark.parametrize(
    "store_cls", [CourtVectorStore, MevzuatVectorStore], ids=["court", "mevzuat"]
)
def test_zero_threshold_returns_documents_matching_scores(store_cls):
    store = _populated(store_cls(dimension=2))
    query = np.array([1.0, 0.0], dtype=np.float32)

    results = store.search(query, top_k=2, threshold=0.0)

    ids = [doc.id for doc, _ in results]
    scores = [score for _, score in results]
    # Before the fix this returned ['mid', 'neg'] (filtered-array indices
    # applied to the unfiltered document list).
    assert ids == ["best", "mid"]
    assert scores == pytest.approx([1.0, 0.6], abs=1e-5)
    assert all(score >= 0.0 for score in scores)


@pytest.mark.parametrize(
    "store_cls", [CourtVectorStore, MevzuatVectorStore], ids=["court", "mevzuat"]
)
def test_positive_threshold_still_filters_and_aligns(store_cls):
    store = _populated(store_cls(dimension=2))
    query = np.array([1.0, 0.0], dtype=np.float32)

    results = store.search(query, top_k=3, threshold=0.7)

    assert [doc.id for doc, _ in results] == ["best"]
    assert results[0][1] == pytest.approx(1.0, abs=1e-5)


@pytest.mark.parametrize(
    "store_cls", [CourtVectorStore, MevzuatVectorStore], ids=["court", "mevzuat"]
)
def test_no_threshold_returns_full_ranking(store_cls):
    store = _populated(store_cls(dimension=2))
    query = np.array([1.0, 0.0], dtype=np.float32)

    results = store.search(query, top_k=3)

    assert [doc.id for doc, _ in results] == ["best", "mid", "neg"]
