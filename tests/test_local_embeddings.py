import numpy as np
import pytest
from fastapi.testclient import TestClient

from semantic_search.local_embeddings import LocalE5, masked_mean_normalize, DIMENSION, MODEL_ID
from semantic_search.local_embedding_server import create_app


def test_pooling_excludes_padding_and_normalizes():
    vectors = masked_mean_normalize(np.array([[[3., 4.], [999., -999.]]]), np.array([[1, 0]]))
    np.testing.assert_allclose(vectors, [[0.6, 0.8]], atol=1e-6)


@pytest.mark.parametrize("hidden,mask", [
    (np.zeros((1, 2, 3)), np.zeros((1, 2))),
    (np.zeros((1, 2, 3)), np.ones((1, 3))),
    (np.full((1, 2, 3), float("nan")), np.ones((1, 2))),
    (np.zeros((1, 2, 3)), np.ones((1, 2))),
])
def test_pooling_rejects_unusable_vectors(hidden, mask):
    with pytest.raises(ValueError):
        masked_mean_normalize(hidden, mask)


def test_missing_assets_fail_before_loading_a_runtime(tmp_path):
    with pytest.raises(ValueError, match="integrity"):
        LocalE5(tmp_path)


class FakeBackend:
    def __init__(self):
        self.calls = []

    def embed(self, texts):
        self.calls.append(texts)
        return [[1.0] + [0.0] * (DIMENSION - 1) for _ in texts]


def test_openai_contract_batches_41_inputs_without_reordering():
    backend = FakeBackend()
    client = TestClient(create_app(backend), base_url="http://127.0.0.1")
    texts = [f"passage: belge {i}" for i in range(41)]
    response = client.post("/v1/embeddings", json={"model": MODEL_ID, "input": texts})
    assert response.status_code == 200
    assert [len(call) for call in backend.calls] == [16, 16, 9]
    assert sum(backend.calls, []) == texts
    assert [item["index"] for item in response.json()["data"]] == list(range(41))
    assert all(len(item["embedding"]) == DIMENSION for item in response.json()["data"])


def test_long_query_string_is_not_subject_to_the_batch_count_limit():
    client = TestClient(create_app(FakeBackend()), base_url="http://localhost")
    assert client.post("/v1/embeddings", json={"model": MODEL_ID, "input": "query: " + "işçilik " * 30}).status_code == 200


@pytest.mark.parametrize("overrides", [
    {"model": "wrong"}, {"input": []}, {"input": ["x"] * 42},
    {"input": ["x" * 32001]}, {"input": " "}, {"dimensions": 768},
    {"input": [1]}, {"encoding_format": "base64"},
])
def test_invalid_requests_never_reach_model(overrides):
    backend = FakeBackend()
    client = TestClient(create_app(backend), base_url="http://127.0.0.1")
    response = client.post("/v1/embeddings", json={"model": MODEL_ID, "input": ["query: örnek"], **overrides})
    assert response.status_code == 422
    assert backend.calls == []


def test_remote_origin_and_rebinding_host_are_rejected():
    backend = FakeBackend()
    client = TestClient(create_app(backend), base_url="http://127.0.0.1")
    payload = {"model": MODEL_ID, "input": ["query: örnek"]}
    assert client.post("/v1/embeddings", json=payload, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert client.post("/v1/embeddings", json=payload, headers={"Host": "untrusted.example"}).status_code == 400
    assert backend.calls == []


def test_worker_failure_is_typed_and_does_not_lock_out_retry():
    class Flaky(FakeBackend):
        first = True

        def embed(self, texts):
            if self.first:
                self.first = False
                raise ValueError("private input must not be echoed")
            return super().embed(texts)

    client = TestClient(create_app(Flaky()), base_url="http://localhost")
    payload = {"model": MODEL_ID, "input": ["query: örnek"]}
    response = client.post("/v1/embeddings", json=payload)
    assert response.status_code == 503
    assert "private input" not in response.text
    assert client.post("/v1/embeddings", json=payload).status_code == 200
