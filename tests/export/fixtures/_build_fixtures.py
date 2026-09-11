"""Regenerate the export test fixtures from the SYNTHETIC corpus.

Run:

    C:/.../.venv/Scripts/python.exe tests/export/fixtures/_build_fixtures.py

Why a generator instead of hand-written JSON: every ``quoteSha256``,
``contentSha256`` and code-point offset in the fixtures is REAL — computed
from the actual text under ``evals/fixtures/corpus``. A hand-edited fixture
would drift, and a fixture with fake hashes would make the export
verification tests meaningless (they would only prove the exporter can copy
a string it was given).

The corpus is SENTETİK: not real Turkish legislation and not real Yargıtay /
KVKK decisions. Both produced bundles carry ``synthetic: true``, so every
export made from them is labelled ``SENTETİK`` on every human-visible
surface.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS = REPO_ROOT / "evals" / "fixtures" / "corpus"
HERE = Path(__file__).resolve().parent

SYNTHETIC_NOTICE = (
    "Kaynaklar evals/fixtures/corpus altındaki sentetik test korpusundan"
    " üretilmiştir; gerçek Türk mevzuatı veya gerçek mahkeme kararı değildir."
)


def _canonical(name: str) -> tuple[dict, str]:
    """Load a corpus document and return (raw json, NFC canonical text)."""
    payload = json.loads((CORPUS / f"{name}.json").read_text(encoding="utf-8"))
    return payload, unicodedata.normalize("NFC", payload["text"])


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _span(text: str, start_marker: str) -> tuple[int, int]:
    """Code-point span from ``start_marker`` to the next blank line."""
    start = text.index(start_marker)
    end = text.find("\n\n", start)
    if end == -1:
        end = len(text)
    return start, end


def _evidence(
    *,
    evidence_id: str,
    corpus_name: str,
    start_marker: str,
    source: str,
    court: str | None = None,
    decision_date: str | None = None,
    docket_no: str | None = None,
    decision_no: str | None = None,
    legislation_no: str | None = None,
    article: str | None = None,
    authority_tier: int,
    authority_label: str,
    currentness: str,
    stance: str,
    retrieval_score: float,
) -> tuple[dict, str, str]:
    payload, text = _canonical(corpus_name)
    start, end = _span(text, start_marker)
    quote = text[start:end]
    version_id = f"ver-{corpus_name}"
    entry = {
        "evidenceId": evidence_id,
        "documentId": f"doc-{corpus_name}",
        "documentVersionId": version_id,
        "chunkId": f"chunk-{corpus_name}-{start}",
        "source": source,
        "sourceUrl": payload["retrieved_url"],
        "title": payload["title"],
        "locator": {"startChar": start, "endChar": end},
        "quote": quote,
        "quoteSha256": _sha256(quote),
        "contentSha256": _sha256(text),
        "retrievedAt": "2026-08-20T09:00:00Z",
        "authority": {
            "tier": authority_tier,
            "label": authority_label,
            "rationale": "sentetik fixture için elle atanmıştır",
            "score": round(1.0 - (authority_tier - 1) * 0.12, 2),
        },
        "currentness": {
            "status": currentness,
            "score": 1.0 if currentness == "IN_FORCE" else 0.5,
            "asOf": "2026-08-20",
            "rationale": "sentetik fixture için elle atanmıştır",
        },
        "stance": stance,
        "retrievalScore": retrieval_score,
        "synthetic": True,
    }
    if court:
        entry["court"] = court
    if decision_date:
        entry["decisionDate"] = decision_date
    if docket_no:
        entry["docketNo"] = docket_no
    if decision_no:
        entry["decisionNo"] = decision_no
    if legislation_no:
        entry["legislationNo"] = legislation_no
    if article:
        entry["locator"]["article"] = article
    return entry, version_id, text


def build_qualified_bundle() -> dict:
    """A QUALIFIED answer with a real contrary-authority pair."""
    evidence: list[dict] = []
    texts: dict[str, str] = {}

    def add(**kwargs: object) -> None:
        entry, version_id, text = _evidence(**kwargs)  # type: ignore[arg-type]
        evidence.append(entry)
        texts[version_id] = text

    add(
        evidence_id="ev-tck-157",
        corpus_name="kanun_5237_v2",
        start_marker="MADDE 157 - (1)",
        source="MEVZUAT",
        legislation_no="5237",
        article="157",
        authority_tier=1,
        authority_label="Kanun",
        currentness="IN_FORCE",
        stance="supporting",
        retrieval_score=0.94,
    )
    add(
        evidence_id="ev-y15-2024-1187",
        corpus_name="yargitay_karar_1",
        start_marker="GEREKÇE: Dolandırıcılık suçunun oluşabilmesi için failin",
        source="BEDESTEN",
        court="Yargıtay 15. Ceza Dairesi",
        decision_date="2024-03-12",
        docket_no="2023/4521",
        decision_no="2024/1187",
        authority_tier=4,
        authority_label="Yüksek mahkeme dairesi kararı",
        currentness="IN_FORCE",
        stance="supporting",
        retrieval_score=0.88,
    )
    add(
        evidence_id="ev-y15-2024-2356",
        corpus_name="yargitay_karar_2",
        start_marker="GEREKÇE: Dolandırıcılık suçunun oluşabilmesi için hilenin,",
        source="BEDESTEN",
        court="Yargıtay 15. Ceza Dairesi",
        decision_date="2024-06-24",
        docket_no="2023/7810",
        decision_no="2024/2356",
        authority_tier=4,
        authority_label="Yüksek mahkeme dairesi kararı",
        currentness="IN_FORCE",
        stance="contrary",
        retrieval_score=0.85,
    )
    add(
        evidence_id="ev-kvkk-2025-1834",
        corpus_name="kvkk_karar_1",
        start_marker="GEREKÇE: 6698 sayılı",
        source="KVKK",
        court="Kişisel Verileri Koruma Kurulu",
        decision_date="2025-11-20",
        decision_no="2025/1834",
        authority_tier=6,
        authority_label="Kurul kararı",
        currentness="IN_FORCE",
        stance="supporting",
        retrieval_score=0.71,
    )
    # Deliberately retrieved but never cited: exercises the "uncited evidence"
    # path so the export has to report it instead of quietly hiding it.
    add(
        evidence_id="ev-filler-dilekce",
        corpus_name="filler_dilekce",
        start_marker="HUKUKİ NEDENLER:",
        source="TENANT_UPLOAD",
        authority_tier=7,
        authority_label="Taraf beyanı / dilekçe",
        currentness="UNKNOWN",
        stance="neutral",
        retrieval_score=0.21,
    )

    claims = [
        {
            "claimId": "c1-dolandiricilik-unsurlari",
            "text": (
                "Dolandırıcılık suçunun oluşabilmesi için hilenin sözleşmenin"
                " kurulması aşamasında bulunması ve mağduru aldatmaya elverişli"
                " olması gerekir; gerçekte var olmayan bir malın satılıkmış gibi"
                " ilan edilmesi bu niteliktedir."
            ),
            "material": True,
            "evidenceIds": ["ev-tck-157", "ev-y15-2024-1187"],
            "treatment": "supported",
            "verdict": "SUPPORTED",
            "contraryEvidenceIds": [],
            "reasons": [],
            "confidence": {
                "retrieval": 0.94,
                "entailment": 0.9,
                "authority": 0.96,
                "currentness": 1.0,
                "coverage": 0.88,
            },
        },
        {
            "claimId": "c2-edimin-ifa-edilmemesi",
            "text": (
                "Gerçekte mevcut olan bir malın satışında edimin sonradan yerine"
                " getirilmemesi tek başına dolandırıcılık suçunu oluşturmaz;"
                " uyuşmazlık hukuki nitelikte kabul edilir."
            ),
            "material": True,
            "evidenceIds": ["ev-y15-2024-1187"],
            "treatment": "conflicted",
            "verdict": "CONFLICTING_AUTHORITIES",
            "contraryEvidenceIds": ["ev-y15-2024-2356"],
            "reasons": [
                "Aynı dairenin iki kararı, başlangıçtaki hile şartını farklı"
                " somut olaylarda farklı sonuca bağlamıştır; içtihat birliği"
                " tespit edilememiştir."
            ],
            "confidence": {
                "retrieval": 0.86,
                "entailment": 0.74,
                "authority": 0.8,
                "currentness": 1.0,
                "coverage": 0.55,
            },
        },
        {
            "claimId": "c3-kisisel-veri-acik-riza",
            "text": (
                "Pazarlama amaçlı arama için kişisel verinin işlenmesi, ilgili"
                " kişinin açık rızası veya kanunda sayılan bir işleme şartı"
                " bulunmadıkça hukuka aykırıdır."
            ),
            "material": False,
            "evidenceIds": ["ev-kvkk-2025-1834"],
            "treatment": "qualified",
            "verdict": "PARTIAL_SOURCE_COVERAGE",
            "contraryEvidenceIds": [],
            "reasons": [
                "Tespit yalnız tek bir kurul kararına dayanmaktadır; kanun"
                " metni ayrıca doğrulanmalıdır."
            ],
            "confidence": {
                "retrieval": 0.71,
                "entailment": 0.83,
                "authority": 0.55,
                "currentness": 1.0,
                "coverage": 0.4,
            },
        },
        {
            "claimId": "c4-teselsul-iddiasi",
            "text": (
                "Aynı yöntemle birden çok kişiye karşı işlenen eylemlerde"
                " zincirleme suç hükümlerinin ne şekilde uygulanacağı."
            ),
            "material": True,
            "evidenceIds": [],
            "treatment": "unsupported",
            "verdict": "INSUFFICIENT_EVIDENCE",
            "contraryEvidenceIds": [],
            "reasons": [
                "Korpusta bu tespiti doğrulayan pasaj bulunamadı; tespit"
                " kaynaksızdır."
            ],
            "confidence": {
                "retrieval": 0.12,
                "entailment": 0.0,
                "authority": 0.0,
                "currentness": 0.0,
                "coverage": 0.0,
            },
        },
    ]

    return {
        "schema": "collex.answer.evidence-bundle/v1",
        "question": (
            "İnternet ilanı üzerinden kapora alınıp edimin yerine getirilmemesi"
            " dolandırıcılık suçunu oluşturur mu?"
        ),
        "asOf": "2026-08-20",
        "status": "QUALIFIED",
        "finalizable": True,
        "verifiedAt": "2026-08-20T09:05:00Z",
        "reasons": [
            "Bir tespitte çelişen otorite bulunduğu için cevap ŞERHLİ olarak"
            " işaretlenmiştir.",
            "Bir tespit doğrulanabilir kaynak bulunamadığı için kaynaksız"
            " olarak ayrılmıştır.",
        ],
        "claims": claims,
        "evidence": evidence,
        "texts": texts,
        "synthetic": True,
        "syntheticNotice": SYNTHETIC_NOTICE,
        "producer": "collex-control-plane (sentetik fixture üreticisi)",
    }


def build_abstain_bundle() -> dict:
    """An honest abstention: candidates existed, none survived verification."""
    entry, version_id, text = _evidence(
        evidence_id="ev-filler-dilekce",
        corpus_name="filler_dilekce",
        start_marker="HUKUKİ NEDENLER:",
        source="TENANT_UPLOAD",
        authority_tier=7,
        authority_label="Taraf beyanı / dilekçe",
        currentness="UNKNOWN",
        stance="neutral",
        retrieval_score=0.18,
    )
    return {
        "schema": "collex.answer.evidence-bundle/v1",
        "question": (
            "Kripto varlık aracı kurumlarının teminat yükümlülüğü hangi"
            " tebliğle düzenlenmiştir?"
        ),
        "asOf": "2026-08-20",
        "status": "ABSTAIN",
        "finalizable": False,
        "verifiedAt": "2026-08-20T09:07:00Z",
        "reasons": [
            "Hiçbir aday pasaj entailment eşiğini geçemedi.",
            "En yüksek skorlu aday, soruyla konu bakımından ilgisiz bir"
            " dilekçedir.",
        ],
        "claims": [],
        "evidence": [entry],
        "texts": {version_id: text},
        "synthetic": True,
        "syntheticNotice": SYNTHETIC_NOTICE,
        "producer": "collex-control-plane (sentetik fixture üreticisi)",
    }


def main() -> None:
    targets = {
        "bundle_sentetik_serhli.json": build_qualified_bundle(),
        "bundle_sentetik_cekimser.json": build_abstain_bundle(),
    }
    for name, payload in targets.items():
        path = HERE / name
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"wrote {path} ({len(payload['evidence'])} evidence)")


if __name__ == "__main__":
    main()
