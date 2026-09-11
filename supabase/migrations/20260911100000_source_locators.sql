-- 20260911100000_source_locators.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): FIRST and LAST
-- object created by this file; bootstrap needs both.
-- [LEDGER SENTINEL] regclass:legal.document_version_segments
-- [LEDGER SENTINEL] policy:legal.document_version_segments.document_version_segments_select
--
-- Source locators (W19 phase A): map a canonical code-point range back to a
-- place in the ORIGINAL file.
--
-- The problem this closes
-- -----------------------
-- intake/extract.py reads a PDF page by page and then flattens the pages
-- into one canonical string. Before this table the flattening was lossy:
-- the system knew a quote's document version and its [start_char, end_char)
-- range, but nothing could say WHICH PAGE those characters came from. A
-- lawyer checking a citation against the paper file had no page to turn to,
-- and an exhaustive review had no way to prove it had read every page.
--
-- What a row is
-- -------------
-- One contiguous block of the source document -- a physical PDF page, or a
-- DOCX paragraph/table, or the whole body of a flat text file -- together
-- with the half-open code-point range it occupies in
-- legal.document_versions.canonical_text.
--
-- Invariant (mirrors legal.chunks): offsets are Unicode CODE POINTS over
-- the NFC canonical text (ADR-003). ingestion/locators.py measures them
-- against the FINAL canonical text (each block is NFC-normalized before its
-- range is taken) and verifies the map before returning it, so a segment
-- range is an exact slice of canonical_text.
--
-- Physical vs structural locators
-- -------------------------------
-- locator_kind = 'page' is the only PHYSICAL locator and is written only
-- for formats that really have stable pages (PDF). A DOCX has no fixed
-- pagination until it is rendered, so it gets 'paragraph' instead. Writing
-- a page number for a DOCX would be a fabricated citation, which is exactly
-- the class of error this build exists to prevent.
--
-- Unreadable pages are rows, not absences
-- ---------------------------------------
-- A page whose text layer is empty contributes no characters, so its range
-- is EMPTY (start_char = end_char) and it is parked at the position in
-- document order where its content would have been. extraction_status
-- 'UNREADABLE' is what lets processing coverage say "page 7 of 12 could not
-- be read" instead of silently reporting 11 pages as the whole document.
-- The EXCLUDE constraint below tolerates these rows because an empty
-- int4range never overlaps anything.
--
-- Local-testable: yes (no pgvector).

create table if not exists legal.document_version_segments (
  document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  -- 1-based position in document order. For a PDF this is the page number.
  segment_no integer not null check (segment_no >= 1),
  locator_kind text not null
    check (locator_kind in ('page', 'paragraph', 'block', 'section')),
  -- What the reader is shown ("137", "12"). Text, not integer: a scanned
  -- brief can carry printed folio labels that are not plain numbers.
  locator_label text not null check (length(locator_label) between 1 and 40),
  -- Unicode code-point offsets into document_versions.canonical_text.
  -- start_char = end_char means the segment contributed nothing.
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char >= start_char),
  extraction_method text not null
    check (extraction_method in ('pdf_text_layer', 'ocr', 'docx_paragraph',
                                 'docx_table', 'plain_text', 'udf_xml',
                                 'none')),
  extraction_status text not null
    check (extraction_status in ('EXTRACTED', 'SPARSE', 'UNREADABLE')),
  -- OCR confidence when the method is 'ocr'; NULL for a born-digital text
  -- layer, which is not a confidence-bearing process.
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  primary key (document_version_id, segment_no),
  -- A code point belongs to at most ONE segment, for the same reason
  -- legal.chunks forbids overlap (20260826030000 header, P2): position ->
  -- locator must be a FUNCTION, or "which page is this quote on" has two
  -- answers. Empty ranges (unreadable pages) are exempt automatically:
  -- int4range(n, n) is empty and never overlaps.
  constraint document_version_segments_no_overlap
    exclude using gist (
      document_version_id with =,
      int4range(start_char, end_char) with &&
    ),
  -- OCR must record its confidence source; a born-digital layer must not
  -- invent one.
  constraint document_version_segments_confidence_only_for_ocr
    check (confidence is null or extraction_method = 'ocr')
);

comment on table legal.document_version_segments is
  'Canonical code-point ranges mapped to a place in the original file '
  '(PDF page / DOCX paragraph / text block). Unreadable pages are kept as '
  'EMPTY ranges so processing coverage can count what was NOT read. '
  'Built and verified by ingestion/locators.py.';

-- Answers "which segments does this chunk/quote range touch?" -- the read
-- the citation renderer performs for every evidence item.
create index if not exists document_version_segments_range_idx
  on legal.document_version_segments
  using gist (document_version_id, int4range(start_char, end_char));

-- Answers "how many pages of this version are unreadable?" -- the read
-- processing coverage performs per file.
create index if not exists document_version_segments_status_idx
  on legal.document_version_segments (document_version_id, extraction_status);

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
-- Same shape and the same reasoning as chunks_select in
-- 20260826060000_rls.sql: a segment row discloses the structure of its
-- owning document (how many pages, which are unreadable), so it resolves
-- tenancy through the OWNING DOCUMENT rather than trusting a caller-side
-- filter. Writes have no policy on purpose -- RLS denies any command
-- without a matching policy, and the ingestion role bypasses RLS.

alter table legal.document_version_segments enable row level security;

create policy document_version_segments_select on legal.document_version_segments
  for select
  using (
    exists (
      select 1
      from legal.document_versions v
      join legal.documents d on d.id = v.document_id
      where v.id = document_version_id
        and (
          d.scope = 'public'
          or d.tenant_id = (select app_private.current_tenant_id())
        )
    )
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on legal.document_version_segments to authenticated;
  end if;
end
$$;
