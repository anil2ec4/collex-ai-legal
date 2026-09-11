"""Dosya paketi (ZIP) — ``collex.matter-package/v1`` → one archive. W14 · B-30.

WHY. Today a lawyer can export ONE draft or ONE evidence bundle. Handing a
file to a colleague, delivering it to the client, archiving it or answering an
audit all want the FILE, not a document. W13-ENGRISK found the other half of
the same gap: nothing in the codebase ever reads the bytes under
``var/uploads/`` — the lawyer cannot get their own PDF back out of ColleX.

THE ARCHIVE (four folders + a manifest):

    dosya-ozeti.docx        künye, taraflar, kronoloji, süreler, notlar
    belgeler/               the ORIGINAL uploaded files, byte for byte
    taslaklar/              the latest version of each draft, as DOCX
    arastirmalar/           each answer's evidence package (JSON + DOCX)
    MANIFEST.json           sha256 of every entry, plus what produced it

THE HARD RULE, identical to every other export path: **if a single citation
cannot be verified, no package is written.** The drafts in `taslaklar/` go
through `export.petition`, which runs `verify_draft_or_refuse` (quote hashes,
citation closure AND the B-01 quote-integrity check) before a byte is
produced; a refusal propagates and the temporary archive is deleted. A
half-written package is worse than none, because it looks complete.

Every original is verified against the sha256 the plan declares BEFORE it
enters the archive: an upload whose bytes no longer match its recorded digest
is a corrupted file, and shipping it silently would be the exact failure this
product exists to prevent.

Standard library only (``zipfile``), plus ``python-docx`` through the draft
and bundle writers.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from export.errors import ExportError, ExportRefused

PACKAGE_SCHEMA = "collex.matter-package/v1"
FORMAT_NAME = "dosya-paketi-zip"
MANIFEST_NAME = "MANIFEST.json"
MANIFEST_SCHEMA = "collex.matter-package.manifest/v1"

SUMMARY_NAME = "dosya-ozeti.docx"
DOCUMENTS_DIR = "belgeler"
DRAFTS_DIR = "taslaklar"
RESEARCH_DIR = "arastirmalar"

#: Fixed zip timestamp so the same plan produces the same archive.
_ZIP_DATE = (2026, 1, 1, 0, 0, 0)

#: Printed in the manifest and in the summary — the package holds client data.
PACKAGE_NOTICE = (
    "Bu paket müvekkil verisi içerir. Şifreli bir diske koyun, e-posta ekiyle"
    " göndermeden önce şifreleyin."
)


class PackageFormatError(ExportError):
    """The input JSON is not a valid ``collex.matter-package/v1`` plan."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# Plan
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PlannedDocument:
    """One uploaded original to copy into ``belgeler/``."""

    file_name: str
    source_path: Path
    sha256: str


@dataclass(frozen=True)
class PlannedDraft:
    """One draft (its latest version) to render into ``taslaklar/``."""

    file_name: str
    draft_path: Path


@dataclass(frozen=True)
class PlannedAnswer:
    """One evidence bundle to render into ``arastirmalar/``."""

    file_name: str
    bundle_path: Path


@dataclass(frozen=True)
class PackagePlan:
    matter_id: str
    matter_title: str
    summary_path: Path | None
    documents: tuple[PlannedDocument, ...] = ()
    drafts: tuple[PlannedDraft, ...] = ()
    answers: tuple[PlannedAnswer, ...] = ()
    generated_at: str = ""
    notes: tuple[str, ...] = field(default=())


def _require_str(payload: Any, key: str, *, where: str, allow_empty: bool = False) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or (not allow_empty and value == ""):
        raise PackageFormatError(f"{where}: '{key}' alanı eksik veya geçersiz")
    return value


def _safe_name(value: str, *, where: str) -> str:
    """A single archive path segment: no separators, no traversal, no drive."""
    name = value.strip()
    if name in ("", ".", ".."):
        raise PackageFormatError(f"{where}: dosya adı geçersiz")
    if "/" in name or "\\" in name or ":" in name:
        raise PackageFormatError(f"{where}: dosya adı yol ayıracı içeremez ({name!r})")
    if PurePosixPath(name).name != name:
        raise PackageFormatError(f"{where}: dosya adı geçersiz ({name!r})")
    return name


def parse_plan(payload: Any) -> PackagePlan:
    if not isinstance(payload, dict):
        raise PackageFormatError("paket planı bir JSON nesnesi değil")
    schema = payload.get("schema", PACKAGE_SCHEMA)
    if schema != PACKAGE_SCHEMA:
        raise PackageFormatError(f"desteklenmeyen şema: {schema!r} (beklenen {PACKAGE_SCHEMA})")

    documents: list[PlannedDocument] = []
    for index, item in enumerate(payload.get("documents") or []):
        if not isinstance(item, dict):
            raise PackageFormatError(f"documents[{index}] bir nesne değil")
        where = f"documents[{index}]"
        sha = _require_str(item, "sha256", where=where)
        if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise PackageFormatError(f"{where}: 'sha256' 64 onaltılık karakter olmalı")
        documents.append(
            PlannedDocument(
                file_name=_safe_name(_require_str(item, "fileName", where=where), where=where),
                source_path=Path(_require_str(item, "sourcePath", where=where)),
                sha256=sha,
            )
        )

    drafts: list[PlannedDraft] = []
    for index, item in enumerate(payload.get("drafts") or []):
        if not isinstance(item, dict):
            raise PackageFormatError(f"drafts[{index}] bir nesne değil")
        where = f"drafts[{index}]"
        drafts.append(
            PlannedDraft(
                file_name=_safe_name(_require_str(item, "fileName", where=where), where=where),
                draft_path=Path(_require_str(item, "draftPath", where=where)),
            )
        )

    answers: list[PlannedAnswer] = []
    for index, item in enumerate(payload.get("answers") or []):
        if not isinstance(item, dict):
            raise PackageFormatError(f"answers[{index}] bir nesne değil")
        where = f"answers[{index}]"
        answers.append(
            PlannedAnswer(
                file_name=_safe_name(_require_str(item, "fileName", where=where), where=where),
                bundle_path=Path(_require_str(item, "bundlePath", where=where)),
            )
        )

    summary_raw = payload.get("summaryPath")
    notes_raw = payload.get("notes") or []
    if not isinstance(notes_raw, list) or not all(isinstance(n, str) for n in notes_raw):
        raise PackageFormatError("paket planı: 'notes' geçersiz")

    return PackagePlan(
        matter_id=_require_str(payload, "matterId", where="paket planı"),
        matter_title=_require_str(payload, "matterTitle", where="paket planı", allow_empty=True),
        summary_path=None if summary_raw in (None, "") else Path(str(summary_raw)),
        documents=tuple(documents),
        drafts=tuple(drafts),
        answers=tuple(answers),
        generated_at=str(payload.get("generatedAt") or ""),
        notes=tuple(notes_raw),
    )


def load_plan(path: str | Path) -> PackagePlan:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise PackageFormatError(f"paket planı okunamadı: {exc}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PackageFormatError(f"paket planı JSON değil: {exc}") from exc
    return parse_plan(payload)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PackageResult:
    path: Path
    format: str
    entry_count: int
    document_count: int
    draft_count: int
    answer_count: int
    size_bytes: int

    def summary(self) -> str:
        return " | ".join(
            [
                f"DOSYA-PAKETI yazıldı: {self.path}",
                f"belge: {self.document_count}",
                f"taslak: {self.draft_count}",
                f"araştırma: {self.answer_count}",
                f"girdi: {self.entry_count}",
                f"boyut: {self.size_bytes} B",
            ]
        )


def _render_drafts(plan: PackagePlan, work: Path) -> list[tuple[str, Path]]:
    """Render every draft to DOCX. A refusal here refuses the whole package."""
    from export.draft import load_draft
    from export.petition import export_petition_docx

    out: list[tuple[str, Path]] = []
    for planned in plan.drafts:
        draft = load_draft(planned.draft_path)
        target = work / planned.file_name
        # `export_petition_docx` calls `verify_draft_or_refuse` first: quote
        # hashes, citation closure and the B-01 quote-integrity check. An
        # unverifiable draft raises ExportRefused and the package dies with it.
        export_petition_docx(draft, target)
        out.append((f"{DRAFTS_DIR}/{planned.file_name}", target))
    return out


def _render_answers(plan: PackagePlan, work: Path) -> list[tuple[str, Path]]:
    """Copy each evidence bundle JSON and render its DOCX beside it."""
    from export.bundle import load_bundle
    from export.bundle_docx import export_docx

    out: list[tuple[str, Path]] = []
    for planned in plan.answers:
        stem = Path(planned.file_name).stem
        bundle = load_bundle(planned.bundle_path)
        json_target = work / f"{stem}.json"
        json_target.write_bytes(Path(planned.bundle_path).read_bytes())
        docx_target = work / f"{stem}.docx"
        # Same discipline: the bundle writer re-verifies every quote hash and
        # offset before writing, and refuses otherwise.
        export_docx(bundle, docx_target)
        out.append((f"{RESEARCH_DIR}/{stem}.json", json_target))
        out.append((f"{RESEARCH_DIR}/{stem}.docx", docx_target))
    return out


def export_matter_package(
    plan: PackagePlan,
    out_path: str | Path,
    *,
    generated_at: str | None = None,
) -> PackageResult:
    """Verify, render, archive, re-open, self-check, then publish."""
    from export import __version__

    stamp = generated_at or plan.generated_at or datetime.now().astimezone().isoformat(
        timespec="seconds"
    )

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="collex-package-") as work_name:
        work = Path(work_name)
        entries: list[tuple[str, Path]] = []

        if plan.summary_path is not None:
            if not plan.summary_path.is_file():
                raise ExportRefused(
                    "paket yazılmadı: dosya özeti bulunamadı",
                    [f"OZET_YOK: {plan.summary_path}"],
                )
            entries.append((SUMMARY_NAME, plan.summary_path))

        # Originals: byte-for-byte, and only when the bytes still hash to what
        # the plan says they hash to.
        missing: list[str] = []
        for document in plan.documents:
            if not document.source_path.is_file():
                missing.append(f"ASIL_YOK: {document.file_name} ({document.source_path})")
                continue
            actual = sha256_file(document.source_path)
            if actual != document.sha256:
                missing.append(
                    f"ASIL_BOZUK: {document.file_name} — kayıtlı sha256 ile"
                    " dosyanın kendisi uyuşmuyor"
                )
                continue
            entries.append((f"{DOCUMENTS_DIR}/{document.file_name}", document.source_path))
        if missing:
            raise ExportRefused("paket yazılmadı: asıl belgeler doğrulanamadı", missing)

        entries.extend(_render_drafts(plan, work))
        entries.extend(_render_answers(plan, work))

        manifest = {
            "schema": MANIFEST_SCHEMA,
            "matterId": plan.matter_id,
            "matterTitle": plan.matter_title,
            "generatedAt": stamp,
            "producedBy": f"ColleX export {__version__}",
            "notice": PACKAGE_NOTICE,
            "notes": list(plan.notes),
            "entries": [
                {
                    "path": archive_path,
                    "sha256": sha256_file(source),
                    "sizeBytes": source.stat().st_size,
                }
                for archive_path, source in entries
            ],
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

        handle, tmp_name = tempfile.mkstemp(
            prefix=f".{target.stem}-", suffix=".zip.tmp", dir=str(target.parent)
        )
        os.close(handle)
        tmp_path = Path(tmp_name)
        try:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as archive:
                for archive_path, source in entries:
                    info = zipfile.ZipInfo(archive_path, date_time=_ZIP_DATE)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, source.read_bytes())
                info = zipfile.ZipInfo(MANIFEST_NAME, date_time=_ZIP_DATE)
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, manifest_bytes)
            _self_check(tmp_path, manifest)
            os.replace(tmp_path, target)
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise

    return PackageResult(
        path=target,
        format=FORMAT_NAME,
        entry_count=len(manifest["entries"]),  # type: ignore[arg-type]
        document_count=len(plan.documents),
        draft_count=len(plan.drafts),
        answer_count=len(plan.answers),
        size_bytes=target.stat().st_size,
    )


def _self_check(path: Path, manifest: dict[str, Any]) -> None:
    """Re-open the archive and prove every manifest digest holds INSIDE it."""
    failures: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if MANIFEST_NAME not in names:
            failures.append("MANIFEST_YOK: arşivde MANIFEST.json yok")
        for entry in manifest["entries"]:
            archive_path = entry["path"]
            if archive_path not in names:
                failures.append(f"GIRDI_YOK: {archive_path} arşivde yok")
                continue
            actual = sha256_bytes(archive.read(archive_path))
            if actual != entry["sha256"]:
                failures.append(f"GIRDI_OZETI: {archive_path} sha256 tutmuyor")
        extra = names - {MANIFEST_NAME} - {e["path"] for e in manifest["entries"]}
        if extra:
            failures.append(f"FAZLA_GIRDI: manifestte olmayan girdi(ler): {sorted(extra)}")
    if failures:
        raise ExportRefused("paket kendisiyle doğrulanamadı; dosya yazılmadı", failures)


# --------------------------------------------------------------------------
# Read-back (used by the tests and by anyone verifying a delivered package)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PackageReport:
    names: tuple[str, ...]
    manifest: dict[str, Any]


def read_package(path: str | Path) -> PackageReport:
    with zipfile.ZipFile(str(path)) as archive:
        names = tuple(archive.namelist())
        if MANIFEST_NAME not in names:
            raise ExportRefused("paket okunamadı", ["MANIFEST_YOK: arşivde MANIFEST.json yok"])
        manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
    return PackageReport(names=names, manifest=manifest)


def verify_package(path: str | Path) -> list[str]:
    """Independent verification: recompute every digest INSIDE the archive.

    Returns the list of problems; empty means the package verifies. This is
    the routine a recipient runs — it needs nothing from this system except
    the archive itself.
    """
    problems: list[str] = []
    with zipfile.ZipFile(str(path)) as archive:
        names = set(archive.namelist())
        if MANIFEST_NAME not in names:
            return ["MANIFEST_YOK: arşivde MANIFEST.json yok"]
        manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
        for entry in manifest.get("entries", []):
            archive_path = entry.get("path", "")
            if archive_path not in names:
                problems.append(f"GIRDI_YOK: {archive_path}")
                continue
            if sha256_bytes(archive.read(archive_path)) != entry.get("sha256"):
                problems.append(f"GIRDI_OZETI: {archive_path}")
        for name in sorted(names - {MANIFEST_NAME}):
            if name not in {e.get("path") for e in manifest.get("entries", [])}:
                problems.append(f"FAZLA_GIRDI: {name}")
    return problems
