-- 20260826110000_turkish_fts.sql
-- Turkish full-text-search lane for legal.chunks.
--
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the generated
-- column (first) and its GIN index (last).
-- [LEDGER SENTINEL] column:legal.chunks.search_tsv_tr
-- [LEDGER SENTINEL] regclass:legal.chunks_fts_tr_gin
--
-- Adds a second generated tsvector column using PostgreSQL's built-in
-- 'turkish' snowball configuration plus a GIN index. The existing
-- 'simple'-config column (search_tsv, migration 20260826030000) is kept
-- UNTOUCHED as the recall-comparison baseline: brief 8.6 requires the
-- Turkish stemmer to be compared against 'simple' on the gold set before
-- any default switch, so both lanes stay queryable side by side.
--
-- Measured behaviour on PostgreSQL 18.1 (see
-- control-plane/tests/store/retrieval.test.ts, test (a), for the executable
-- proof — it re-measures every string below and fails if the server output
-- changes):
--   to_tsvector('turkish', 'dolandırıcılığın cezası dolandırıcılık')
--     => 'cezas':2 'dolandırıcılık':1,3
--   to_tsvector('simple',  same input)
--     => 'cezası':2 'dolandırıcılık':3 'dolandırıcılığın':1
-- i.e. the genitive 'dolandırıcılığın' and bare 'dolandırıcılık' unify
-- under 'turkish' but stay distinct surface forms under 'simple'. On the
-- fixture corpus that is recall 1.00 (turkish) vs 0.00 (simple) for the
-- query "dolandırıcılığın cezası".
--
-- KNOWN LIMIT of the snowball stemmer, also measured and asserted there:
--   to_tsvector('turkish', 'zamanaşımı')            => 'zamanaş'
--   websearch_to_tsquery('turkish', 'zamanaşımının') => 'zamanaşım'
-- two inflections of the same word, two stems, no match. Neither config
-- folds the dotted/dotless I pair either ('ıstanbul' vs 'istanbul' share no
-- lexeme) — that gap is covered by the pg_trgm word_similarity lane, not
-- here. So this is a large recall gain, not a solved problem, which is why
-- search_tsv (simple) stays as the A/B baseline until the gold-set
-- comparison of brief 8.6 blesses a default switch.
--
-- Local-testable: yes ('turkish' is a stock snowball config; no pgvector).
-- Applied for real by scripts/db_local_check.py (which selects migrations by
-- the pgvector marker via ingestion/migrations.py, not by filename order)
-- and by the control-plane store integration tests.

alter table legal.chunks
  add column search_tsv_tr tsvector
    generated always as
      (to_tsvector('turkish'::regconfig, coalesce(search_text, ''))) stored;

comment on column legal.chunks.search_tsv_tr is
  'Turkish-stemmed FTS lane (snowball ''turkish'' config over search_text). '
  'search_tsv (simple config) is intentionally kept as the comparison '
  'baseline per brief 8.6.';

create index chunks_fts_tr_gin
  on legal.chunks using gin (search_tsv_tr);
