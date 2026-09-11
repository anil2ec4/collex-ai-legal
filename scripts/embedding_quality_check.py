"""Small, repeatable Turkish legal-domain sanity check for the configured embedder."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

from semantic_search.embedder import get_embedder  # noqa: E402


DOCUMENTS = {
    "muris_muvazaasi": (
        "Miras bırakanın gerçek iradesi bağış olduğu hâlde satış göstererek taşınmazı "
        "bir mirasçıya devretmesi nedeniyle tapu iptali ve tescil istemi."
    ),
    "kidem_tazminati": (
        "İşçinin haklı nedenle feshi üzerine kıdem tazminatına esas ücret ve çalışma "
        "süresinin belirlenmesi uyuşmazlığı."
    ),
    "kdv_indirimi": (
        "Katma değer vergisinde indirim hakkı, sahte fatura iddiası ve vergi ziyaı "
        "cezasının hukuka uygunluğu."
    ),
    "imar_iptal": (
        "Belediye imar planı değişikliğinin şehircilik ilkelerine aykırılığı nedeniyle "
        "idari işlemin iptali istemi."
    ),
}

QUERIES = {
    "muris_muvazaasi": "Babadan kalan taşınmazın satış gibi gösterilen bağışla kaçırılması",
    "kidem_tazminati": "Haklı fesih yapan işçinin kıdem tazminatı hesabı",
    "kdv_indirimi": "Sahte faturalar yüzünden KDV indirimlerinin reddedilmesi",
    "imar_iptal": "Hukuka aykırı belediye imar planının iptal edilmesi",
}


def main() -> None:
    embedder = get_embedder()
    labels = list(DOCUMENTS)
    document_vectors = embedder.encode_documents(
        list(DOCUMENTS.values()), titles=labels
    )

    correct = 0
    for expected, query in QUERIES.items():
        query_vector = embedder.encode_query(query, "Turkish legal decision retrieval")
        scores = np.dot(document_vectors, query_vector)
        order = np.argsort(scores)[::-1]
        top = labels[int(order[0])]
        correct += int(top == expected)
        ranking = ", ".join(
            f"{labels[int(index)]}={float(scores[int(index)]):.3f}"
            for index in order
        )
        print(f"{expected}: top={top} | {ranking}")

    print(
        f"model={embedder.model} dimension={embedder.dimension} "
        f"top1={correct}/{len(QUERIES)}"
    )
    assert correct == len(QUERIES), "configured embedder failed the legal-domain sanity check"


if __name__ == "__main__":
    main()
