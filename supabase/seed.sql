-- supabase/seed.sql -- GENERATED FILE (see lane-4 generator); synthetic
-- Turkish legislation excerpts for local verification and dev bootstrap.
-- All sha256 values are REAL digests of the UTF-8 bytes of the adjacent
-- text columns, and all start_char/end_char offsets are Unicode code-point
-- offsets into canonical_text -- scripts/db_local_check.py re-verifies both
-- invariants inside Postgres after seeding.
-- Idempotent: every insert is "on conflict do nothing" with fixed UUIDs.

set client_encoding = 'UTF8';

begin;

-- Embedding profile registry rows (1024-dim lane). These also satisfy the
-- FK targets used by the pgvector partitions in 20260826080000.
insert into legal.embedding_profiles
  (profile_key, provider, model, dimensions, distance_metric,
   normalization_version, chunker_version, config)
values
  ('voyage-4-1024-v1', 'voyage', 'voyage-4', 1024, 'cosine',
   'trnorm-v1', 'chunker-v1', '{}'::jsonb),
  ('bge-m3-1024-v1', 'baai', 'bge-m3', 1024, 'cosine',
   'trnorm-v1', 'chunker-v1', '{}'::jsonb)
on conflict do nothing;

-- Document: TBK-6098-EXCERPT
insert into legal.documents
  (id, scope, tenant_id, source, external_id, document_type, jurisdiction,
   title, canonical_source_url)
values
  ('00000000-0000-4000-8000-000000000101', 'public', null, 'seed-mevzuat',
   'TBK-6098-EXCERPT', 'kanun', 'TR',
   'Türk Borçlar Kanunu (sentetik alıntı)',
   'https://example.invalid/seed/TBK-6098-EXCERPT')
on conflict do nothing;

insert into legal.source_snapshots
  (id, source, external_id, requested_url, final_url, retrieved_at,
   http_status, media_type, raw_object_key, raw_sha256,
   parser_name, parser_version, metadata)
values
  ('00000000-0000-4000-8000-000000000201', 'seed-mevzuat', 'TBK-6098-EXCERPT',
   'https://example.invalid/seed/TBK-6098-EXCERPT',
   'https://example.invalid/seed/TBK-6098-EXCERPT',
   '2026-08-26T00:00:00Z', 200, 'text/html',
   'seed/TBK-6098-EXCERPT.html',
   '8ffe975c5da240a61551fc25a8e5fe5915d6d10c365299c8c909b3148b8fe1d7',
   'seed-parser', '1.0.0', '{}'::jsonb)
on conflict do nothing;

insert into legal.document_versions
  (id, document_id, source_snapshot_id, version_label, status,
   effective_period, legislation_no, canonical_text, normalized_text,
   content_sha256, structure)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201',
   'seed-v1', 'published',
   daterange('2012-07-01'::date, null, '[)'),
   '6098',
   'Madde 1 - Sözleşme, tarafların iradelerini karşılıklı ve birbirine uygun olarak açıklamalarıyla kurulur.
Madde 2 - Taraflar sözleşmenin esaslı noktalarında uyuşmuşlarsa, ikinci derecedeki noktalar üzerinde durulmamış olsa bile, sözleşme kurulmuş sayılır.',
   'madde 1 - sözleşme, tarafların iradelerini karşılıklı ve birbirine uygun olarak açıklamalarıyla kurulur.
madde 2 - taraflar sözleşmenin esaslı noktalarında uyuşmuşlarsa, ikinci derecedeki noktalar üzerinde durulmamış olsa bile, sözleşme kurulmuş sayılır.',
   '75a8fdc87d07e7daaf79d782570484c431cde6ed8d73c98f2b83d4dba32f6174', '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000301', 0,
   array['madde-1'], '1',
   0, 104,
   'Madde 1 - Sözleşme, tarafların iradelerini karşılıklı ve birbirine uygun olarak açıklamalarıyla kurulur.',
   'madde 1 - sözleşme, tarafların iradelerini karşılıklı ve birbirine uygun olarak açıklamalarıyla kurulur.',
   '2d8e5bbf391a36c29ad299711b17bec8eabd054217f4ac47d90af0d69e2730e7', 13, '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000301', 1,
   array['madde-2'], '2',
   105, 254,
   'Madde 2 - Taraflar sözleşmenin esaslı noktalarında uyuşmuşlarsa, ikinci derecedeki noktalar üzerinde durulmamış olsa bile, sözleşme kurulmuş sayılır.',
   'madde 2 - taraflar sözleşmenin esaslı noktalarında uyuşmuşlarsa, ikinci derecedeki noktalar üzerinde durulmamış olsa bile, sözleşme kurulmuş sayılır.',
   '16ede7136a9d635160d2b30ab422d1d97b0e0a766e4ccfd7022cea5bcb141166', 18, '{}'::jsonb)
on conflict do nothing;

-- Document: IYUK-2577-EXCERPT
insert into legal.documents
  (id, scope, tenant_id, source, external_id, document_type, jurisdiction,
   title, canonical_source_url)
values
  ('00000000-0000-4000-8000-000000000102', 'public', null, 'seed-mevzuat',
   'IYUK-2577-EXCERPT', 'kanun', 'TR',
   'İdari Yargılama Usulü Kanunu (sentetik alıntı)',
   'https://example.invalid/seed/IYUK-2577-EXCERPT')
on conflict do nothing;

insert into legal.source_snapshots
  (id, source, external_id, requested_url, final_url, retrieved_at,
   http_status, media_type, raw_object_key, raw_sha256,
   parser_name, parser_version, metadata)
values
  ('00000000-0000-4000-8000-000000000202', 'seed-mevzuat', 'IYUK-2577-EXCERPT',
   'https://example.invalid/seed/IYUK-2577-EXCERPT',
   'https://example.invalid/seed/IYUK-2577-EXCERPT',
   '2026-08-26T00:00:00Z', 200, 'text/html',
   'seed/IYUK-2577-EXCERPT.html',
   'd3b796e73e594d6c8abb699c66e1d1d409b1abb376c571a06bd738132607e2ed',
   'seed-parser', '1.0.0', '{}'::jsonb)
on conflict do nothing;

insert into legal.document_versions
  (id, document_id, source_snapshot_id, version_label, status,
   effective_period, legislation_no, canonical_text, normalized_text,
   content_sha256, structure)
values
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202',
   'seed-v1', 'published',
   daterange('1982-01-20'::date, null, '[)'),
   '2577',
   'Madde 2 - İdari dava türleri şunlardır: İdari işlemler hakkında yetki, şekil, sebep, konu ve maksat yönlerinden biri ile hukuka aykırı olduklarından dolayı iptalleri için menfaatleri ihlal edilenler tarafından açılan iptal davaları.
Madde 7 - Dava açma süresi, özel kanunlarında ayrı süre gösterilmeyen hallerde Danıştayda ve idare mahkemelerinde altmış gündür.',
   'madde 2 - idari dava türleri şunlardır: idari işlemler hakkında yetki, şekil, sebep, konu ve maksat yönlerinden biri ile hukuka aykırı olduklarından dolayı iptalleri için menfaatleri ihlal edilenler tarafından açılan iptal davaları.
madde 7 - dava açma süresi, özel kanunlarında ayrı süre gösterilmeyen hallerde danıştayda ve idare mahkemelerinde altmış gündür.',
   '77fad141ebe95c28ba561052bb3ab5d7517fc35daccd879d4379e35023a57c4a', '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000302', 0,
   array['madde-2'], '2',
   0, 232,
   'Madde 2 - İdari dava türleri şunlardır: İdari işlemler hakkında yetki, şekil, sebep, konu ve maksat yönlerinden biri ile hukuka aykırı olduklarından dolayı iptalleri için menfaatleri ihlal edilenler tarafından açılan iptal davaları.',
   'madde 2 - idari dava türleri şunlardır: idari işlemler hakkında yetki, şekil, sebep, konu ve maksat yönlerinden biri ile hukuka aykırı olduklarından dolayı iptalleri için menfaatleri ihlal edilenler tarafından açılan iptal davaları.',
   '82f8411dcd2173f768973284896c65d1cbab1f1e39d9a1de5041745904c58982', 32, '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000302', 1,
   array['madde-7'], '7',
   233, 361,
   'Madde 7 - Dava açma süresi, özel kanunlarında ayrı süre gösterilmeyen hallerde Danıştayda ve idare mahkemelerinde altmış gündür.',
   'madde 7 - dava açma süresi, özel kanunlarında ayrı süre gösterilmeyen hallerde danıştayda ve idare mahkemelerinde altmış gündür.',
   '0abc2fcb232c8172e76d02c7a456d4d77e49e433b9ced36d5487d2c842be24a0', 18, '{}'::jsonb)
on conflict do nothing;

-- Document: KVKK-6698-EXCERPT
insert into legal.documents
  (id, scope, tenant_id, source, external_id, document_type, jurisdiction,
   title, canonical_source_url)
values
  ('00000000-0000-4000-8000-000000000103', 'public', null, 'seed-mevzuat',
   'KVKK-6698-EXCERPT', 'kanun', 'TR',
   'Kişisel Verilerin Korunması Kanunu (sentetik alıntı)',
   'https://example.invalid/seed/KVKK-6698-EXCERPT')
on conflict do nothing;

insert into legal.source_snapshots
  (id, source, external_id, requested_url, final_url, retrieved_at,
   http_status, media_type, raw_object_key, raw_sha256,
   parser_name, parser_version, metadata)
values
  ('00000000-0000-4000-8000-000000000203', 'seed-mevzuat', 'KVKK-6698-EXCERPT',
   'https://example.invalid/seed/KVKK-6698-EXCERPT',
   'https://example.invalid/seed/KVKK-6698-EXCERPT',
   '2026-08-26T00:00:00Z', 200, 'text/html',
   'seed/KVKK-6698-EXCERPT.html',
   'be4c3085d269fd5281439f54d317cfc6019eb41f7a93c9e72f0baa018d573069',
   'seed-parser', '1.0.0', '{}'::jsonb)
on conflict do nothing;

insert into legal.document_versions
  (id, document_id, source_snapshot_id, version_label, status,
   effective_period, legislation_no, canonical_text, normalized_text,
   content_sha256, structure)
values
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000203',
   'seed-v1', 'published',
   daterange('2016-04-07'::date, null, '[)'),
   '6698',
   'Madde 4 - Kişisel veriler, ancak bu Kanunda ve diğer kanunlarda öngörülen usul ve esaslara uygun olarak işlenebilir.
Madde 7 - İşlenmesini gerektiren sebeplerin ortadan kalkması hâlinde kişisel veriler resen veya ilgili kişinin talebi üzerine veri sorumlusu tarafından silinir, yok edilir veya anonim hâle getirilir.',
   'madde 4 - kişisel veriler, ancak bu kanunda ve diğer kanunlarda öngörülen usul ve esaslara uygun olarak işlenebilir.
madde 7 - işlenmesini gerektiren sebeplerin ortadan kalkması hâlinde kişisel veriler resen veya ilgili kişinin talebi üzerine veri sorumlusu tarafından silinir, yok edilir veya anonim hâle getirilir.',
   '6eb1b213a8570546cf6e550cf872392b90c944e010f09ac26f2abf753ec6c792', '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000303', 0,
   array['madde-4'], '4',
   0, 116,
   'Madde 4 - Kişisel veriler, ancak bu Kanunda ve diğer kanunlarda öngörülen usul ve esaslara uygun olarak işlenebilir.',
   'madde 4 - kişisel veriler, ancak bu kanunda ve diğer kanunlarda öngörülen usul ve esaslara uygun olarak işlenebilir.',
   '2e4a61ac07ff5aa152295cb28fc8115580f1d912f92cee2ec74a022b28dc51ce', 18, '{}'::jsonb)
on conflict do nothing;
insert into legal.chunks
  (id, document_version_id, ordinal, structural_path, article_no,
   start_char, end_char, original_text, search_text, content_sha256,
   token_count, metadata)
values
  ('00000000-0000-4000-8000-000000000432', '00000000-0000-4000-8000-000000000303', 1,
   array['madde-7'], '7',
   117, 316,
   'Madde 7 - İşlenmesini gerektiren sebeplerin ortadan kalkması hâlinde kişisel veriler resen veya ilgili kişinin talebi üzerine veri sorumlusu tarafından silinir, yok edilir veya anonim hâle getirilir.',
   'madde 7 - işlenmesini gerektiren sebeplerin ortadan kalkması hâlinde kişisel veriler resen veya ilgili kişinin talebi üzerine veri sorumlusu tarafından silinir, yok edilir veya anonim hâle getirilir.',
   'fcbb47006ca24fe98946703c6f90da63642ff14402d4b555a50a7e9a2d23d86f', 27, '{}'::jsonb)
on conflict do nothing;
commit;
