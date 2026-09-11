-- 20260826090000_hybrid_search.sql
-- [REQUIRES PGVECTOR] Hybrid lexical + semantic search over the public
-- corpus with Reciprocal Rank Fusion. Follows the master build brief
-- (section 8.3 example RRF SQL) with two adjustments:
--   1. The cosine-distance operator is written operator(extensions.<=>)
--      because the function pins "set search_path = ''" — the bare <=>
--      operator would not resolve with an empty search_path (brief bug).
--   2. Schema names match this repo's migrations (legal.*, extensions.*).
--
-- Local-testable: NO — the local scratch Postgres has no pgvector.
-- scripts/db_local_check.py validates this file's syntax offline with
-- pglast (including the function body) but does NOT execute it.
--
-- corrected 2026-08-27 (P1 determinism; syntax re-validated with pglast,
-- NEVER executed locally — the scratch Postgres has no pgvector):
--   Both branches previously scanned every published version whose
--   effective_period covered as_of_date. Nothing guaranteed there was only
--   ONE such version per document, so a document with two overlapping
--   published versions contributed two near-identical chunk sets and the
--   ranking between them was arbitrary (whatever the plan happened to
--   emit). The 20260826020000 EXCLUDE constraint now forbids the
--   overlapping case for versions with a known effective_period, but
--   versions with a NULL (unknown) effective_period are outside that
--   constraint by construction and would still collide.
--   The query therefore now resolves ONE in-force version per document up
--   front, in an explicit total order, and both the lexical and the
--   semantic branch retrieve only from those versions:
--       distinct on (document_id)
--       order by document_id,
--                lower(effective_period) desc nulls last,  -- most specific
--                lower(system_period)    desc,             -- most recent
--                id desc                                   -- total order
--   A dated version therefore beats an undated one, a later commencement
--   beats an earlier one, and the id tiebreak makes the choice stable
--   across plans. Output columns are unchanged.
--
-- Notes carried from the brief:
-- - 'simple' FTS config is the baseline; Turkish stemming/synonyms must be
--   compared on the gold set before switching.
-- - Exact-reference hits come from a separate deterministic lane and are
--   pinned; they are never demoted by RRF scores.
-- - Authority/currentness scores stay OUT of RRF; they ride along later in
--   the policy/reranker stage.

create or replace function legal.hybrid_search_public_1024(
  query_text text,
  query_embedding extensions.vector(1024),
  embedding_profile text,
  as_of_date date default current_date,
  lexical_limit integer default 80,
  semantic_limit integer default 80,
  result_limit integer default 20,
  rrf_k integer default 60
)
returns table (
  chunk_id uuid,
  document_version_id uuid,
  original_text text,
  lexical_rank bigint,
  semantic_rank bigint,
  rrf_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with in_force as (
    -- Exactly one published version per public document: the text in force
    -- on as_of_date, chosen by a total order so the result never depends
    -- on the plan (see the corrected-2026-08-27 note above).
    select distinct on (v.document_id) v.id
    from legal.document_versions v
    join legal.documents d on d.id = v.document_id
    where d.scope = 'public'
      and v.status = 'published'
      and (
        v.effective_period is null
        or v.effective_period @> as_of_date
      )
    order by
      v.document_id,
      lower(v.effective_period) desc nulls last,
      lower(v.system_period) desc,
      v.id desc
  ),
  lexical as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(
          c.search_tsv,
          websearch_to_tsquery('simple'::regconfig, query_text)
        ) desc
      ) as rank
    from legal.chunks c
    join in_force inf on inf.id = c.document_version_id
    where c.search_tsv @@
        websearch_to_tsquery('simple'::regconfig, query_text)
    order by ts_rank_cd(
      c.search_tsv,
      websearch_to_tsquery('simple'::regconfig, query_text)
    ) desc
    limit lexical_limit
  ),
  semantic as (
    select
      e.chunk_id as id,
      row_number() over (
        order by e.embedding operator(extensions.<=>) query_embedding
      ) as rank
    from legal.public_chunk_embeddings_1024 e
    join legal.chunks c on c.id = e.chunk_id
    join in_force inf on inf.id = c.document_version_id
    where e.profile_key = embedding_profile
    order by e.embedding operator(extensions.<=>) query_embedding
    limit semantic_limit
  ),
  fused as (
    select
      coalesce(l.id, s.id) as id,
      l.rank as lexical_rank,
      s.rank as semantic_rank,
      coalesce(1.0 / (rrf_k + l.rank), 0.0)
        + coalesce(1.0 / (rrf_k + s.rank), 0.0) as score
    from lexical l
    full outer join semantic s on s.id = l.id
  )
  select
    c.id,
    c.document_version_id,
    c.original_text,
    f.lexical_rank,
    f.semantic_rank,
    f.score
  from fused f
  join legal.chunks c on c.id = f.id
  -- c.id tiebreak: RRF scores collide often (equal ranks in both lanes),
  -- and an unordered tail would make the result set unstable run to run.
  order by f.score desc, c.id
  limit result_limit;
$$;
