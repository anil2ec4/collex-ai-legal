"""Generate cross-language offset-policy fixtures for evidence validation.

Canonical offset policy (project-wide):
  * Offsets are UNICODE CODE POINT indices into the NFC-normalized canonical
    text — NOT UTF-16 code units and NOT UTF-8 bytes.
  * The canonical stored form of every document text is NFC.
  * Hashes are SHA-256 hex digests over the UTF-8 encoding.

The generated file, control-plane/fixtures/offset_policy.json, is consumed by
  * control-plane/tests/offset_fixtures.test.ts (TypeScript validateEvidence)
  * tests/contracts/test_offset_policy.py       (Python slicing + hashlib)
proving cross-language parity. Cases flagged `utf16_differs` are the MUST-FAIL
witnesses: naive UTF-16 slicing (JavaScript String.prototype.slice) yields a
different string there, so an implementation that passes them must be
code-point-correct.

Run with the project venv interpreter:
  .venv/Scripts/python.exe scripts/gen_offset_fixtures.py
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path

OUT_PATH = (
    Path(__file__).resolve().parent.parent
    / "control-plane"
    / "fixtures"
    / "offset_policy.json"
)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utf16_units(value: str) -> int:
    """Number of UTF-16 code units (what JavaScript indexing would count)."""
    return len(value.encode("utf-16-le")) // 2


def make_case(
    name: str,
    description: str,
    text: str,
    quote: str,
    *,
    nfd_source: str | None = None,
) -> dict:
    canonical = unicodedata.normalize("NFC", text)
    assert canonical == text, f"{name}: pass already-NFC text to make_case"
    start = canonical.index(quote)  # Python str indices ARE code points
    end = start + len(quote)
    assert canonical[start:end] == quote

    utf16_start = utf16_units(canonical[:start])
    utf16_end = utf16_units(canonical[:end])
    case = {
        "name": name,
        "description": description,
        "canonical_text": canonical,
        "start": start,
        "end": end,
        "expected_quote": quote,
        "expected_quote_sha256": sha256_hex(quote),
        "expected_content_sha256": sha256_hex(canonical),
        # Informational: where a UTF-16-indexed implementation would slice.
        "utf16_start": utf16_start,
        "utf16_end": utf16_end,
        # True => naive UTF-16 slicing at (start, end) returns the WRONG text,
        # so this case is a must-fail witness against UTF-16 offset handling.
        "utf16_differs": utf16_start != start or utf16_end != end,
    }
    if nfd_source is not None:
        assert unicodedata.normalize("NFC", nfd_source) == canonical
        assert nfd_source != canonical, f"{name}: NFD source must differ from NFC"
        case["nfd_source_text"] = nfd_source
    return case


def build_cases() -> list[dict]:
    cases: list[dict] = []

    cases.append(
        make_case(
            "ascii_basic",
            "Plain ASCII: code points == UTF-16 units == bytes-per-char.",
            "Ceza sorumlulugu sahsidir; kimse baskasinin fiilinden sorumlu tutulamaz.",
            "sorumlulugu sahsidir",
        )
    )

    cases.append(
        make_case(
            "turkish_dotted_capital_i",
            "Dotted capital I (U+0130) and other Turkish letters; BMP only.",
            "Madde 2 - İdare, kuruluş ve görevleriyle bir bütündür ve kanunla düzenlenir.",
            "İdare, kuruluş ve görevleriyle",
        )
    )

    cases.append(
        make_case(
            "turkish_dotless_i",
            "Dotless i (U+0131) and dotted capital (U+0130) around the quote.",
            "Işık ve ısı ölçümleri sınır değerlerini aşamaz; İdare bunu denetler.",
            "ısı ölçümleri sınır",
        )
    )

    nfc_text = unicodedata.normalize(
        "NFC",
        "İdarenin her türlü eylem ve işlemlerine karşı yargı yolu açıktır.",
    )
    nfd_text = unicodedata.normalize("NFD", nfc_text)
    cases.append(
        make_case(
            "nfc_canonical_from_nfd_input",
            "Canonical stored form is NFC; the NFD spelling of the same text "
            "is provided so validators can prove they normalize before "
            "slicing/hashing.",
            nfc_text,
            "yargı yolu açıktır",
            nfd_source=nfd_text,
        )
    )

    cases.append(
        make_case(
            "emoji_prefix_utf16_trap",
            "One non-BMP emoji (U+1F600, a surrogate pair in UTF-16) before "
            "the quote shifts UTF-16 indices by one unit: naive UTF-16 "
            "slicing MUST fail here.",
            "⚖ 😀 Mülkiyet hakkı, ancak kamu yararı amacıyla kanunla sınırlanabilir.",
            "Mülkiyet hakkı",
        )
    )

    cases.append(
        make_case(
            "multiple_astral_prefix",
            "Several non-BMP code points (Phoenician letters, classical "
            "building emoji) before a Turkish quote: UTF-16 offsets drift by "
            "three units.",
            "𐤀𐤁 kadim yazı; 🏛 Anayasa Mahkemesi kararına göre özgürlük esastır.",
            "özgürlük esastır",
        )
    )

    cases.append(
        make_case(
            "combining_mark_stays_decomposed",
            "q + U+0303 has no precomposed form, so NFC keeps two code "
            "points; combining marks count as their own code points.",
            "Sözleşme q̃ işareti ile paraflandı ve dosyaya eklendi.",
            "q̃ işareti",
        )
    )

    cases.append(
        make_case(
            "astral_inside_quote",
            "Non-BMP emoji INSIDE the quote: quote length in code points "
            "differs from its UTF-16 length, so both offsets and the slice "
            "width diverge for UTF-16 implementations.",
            "Tutanakta 📜 Kanun metni aynen alıntılandı: 'Hak arama hürriyeti engellenemez.'",
            "📜 Kanun metni",
        )
    )

    cases.append(
        make_case(
            "full_document_span",
            "Quote spans the whole canonical text (start=0, end=length).",
            "Hak arama hürriyeti hiçbir şekilde engellenemez.",
            "Hak arama hürriyeti hiçbir şekilde engellenemez.",
        )
    )

    return cases


def main() -> None:
    cases = build_cases()
    must_fail = [c["name"] for c in cases if c["utf16_differs"]]
    assert must_fail, "fixture set must contain at least one UTF-16 must-fail case"

    fixture = {
        "policy": {
            "offset_unit": "unicode_code_points",
            "normal_form": "NFC",
            "hash": "sha256_hex_over_utf8",
            "description": (
                "locator.startChar/endChar are Unicode code point indices into "
                "the NFC canonical text; hashes are SHA-256 hex over UTF-8. "
                "Cases with utf16_differs=true are must-fail witnesses for "
                "UTF-16-indexed implementations."
            ),
        },
        "generated_by": "scripts/gen_offset_fixtures.py",
        "cases": cases,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {OUT_PATH} ({len(cases)} cases; utf16 must-fail: {', '.join(must_fail)})"
    )


if __name__ == "__main__":
    main()
