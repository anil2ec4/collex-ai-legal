-- Citator lane index: outbound amendment edges by SOURCE PASSAGE.
--
-- Ledger bootstrap probe (ingestion/migrations.py, W12-FIX2): an index is a
-- relation, so to_regclass proves it.
-- [LEDGER SENTINEL] regclass:legal.document_relations_source_chunk_idx
--
-- legal.document_relations already has two indexes, and they cover the two
-- lookups that existed when the table was created (20260826030000):
--
--   document_relations_target_idx (to_document_id, kind)
--       -> the INBOUND citator: "which instruments amend this document?"
--   document_relations_from_idx   (from_document_version_id, kind)
--       -> the version-level fallback used only for edges that carry no
--          source chunk.
--
-- The OUTBOUND citator asks a narrower question than either of those:
-- "which provisions does THIS PASSAGE amend?". It has to be passage-level,
-- because an omnibus ("torba") law amends several unrelated statutes and a
-- reader who reached its first article has not asked about the statute its
-- second article changes — see
-- control-plane/src/store/chunkStore.ts :: citatorLookup. That predicate is
-- `source_chunk_id = any(...)`, which neither existing index serves, so the
-- lane would seq-scan the relation table on every search once a real corpus
-- makes it large.
--
-- Partial on `source_chunk_id is not null`: a null source chunk is handled
-- by the version-level fallback above, and those rows have no business
-- taking up space in this index.
--
-- Runs on a pgvector-less PostgreSQL (no marker line): it is a plain btree
-- index on existing columns.

create index if not exists document_relations_source_chunk_idx
  on legal.document_relations (source_chunk_id, kind)
  where source_chunk_id is not null;

comment on index legal.document_relations_source_chunk_idx is
  'Outbound citator lookups: which provisions does this exact passage amend? '
  'Passage-level, because an omnibus law amends several unrelated statutes '
  'and only the article that made a given change should reach its target.';
