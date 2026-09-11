/**
 * ColleX end-to-end demo — IT IS A TEST, NOT A SLIDESHOW.
 *
 *   node control-plane/scripts/demo.mjs
 *
 * It ingests the synthetic fixture corpus into the local scratch database
 * `collex_demo`, drives SIX scenarios through the real HTTP surface
 * (`POST /v1/answer`, `GET /v1/answers/{id}/evidence-bundle`, and for S6
 * `/v1/matters`, `/v1/drafts` incl. PUT/versions/udf export) plus the tamper
 * checker, writes a markdown report and one raw JSON file per scenario into
 * `demo-output/`, prints a PASS/FAIL table, and EXITS NON-ZERO if any scenario
 * misses its expected state.
 *
 *   S1 SUPPORTED   TCK m. 157'nin cezası -> COMPLETE, exact quotes, and every
 *                  quote re-derived from the canonical text by its own
 *                  code-point offsets (not merely re-hashed).
 *   S2 ABSTENTION  a question the corpus cannot answer -> ABSTAIN with ZERO
 *                  source cards and zero claims.
 *   S3 CONTRARY    the issue the two fixture decisions disagree on -> both
 *                  sides surfaced, claims marked CONFLICTING_AUTHORITIES.
 *   S4 TEMPORAL    the same question either side of the 5237 v1->v2 amendment
 *                  -> different answers, each citing the version in force.
 *   S5 TAMPER      flip ONE character of an S1 quote -> the citation is
 *                  rejected with its reason code, the claim drops to
 *                  unsupported, the answer refuses to finalize.
 *   S6 MATTER      (W12) create a dava dosyası, answer S1 under it, draft a
 *                  dava dilekçesi from that answer under it, PUT one edited
 *                  paragraph -> the matter page shows 1 answer + 1 draft, the
 *                  draft has 2 versions, and the UDF export answers with the
 *                  X-ColleX-Experimental header (deneysel).
 *
 * FLAGS
 *   --dsn <url>     Postgres DSN (default postgres://postgres@127.0.0.1:55432/collex_demo)
 *   --out <dir>     output directory (default <repo>/demo-output)
 *   --keep          reuse the existing database instead of recreating it
 *   --skip-ingest   skip the Python ingestion step entirely (implies --keep)
 *   --python <exe>  interpreter for the ingestion CLI
 *   --force-drop-uploads
 *                   drop collex_demo even when it holds tenant UPLOAD
 *                   documents (W12-F: by default the script REFUSES and
 *                   prints the intake.cli --delete hint — someone pointed
 *                   the console at collex_demo and uploaded real files)
 *
 * SAFETY: the only database this script will ever drop is `collex_demo`; any
 * other name aborts the run. No remote service is contacted at any point.
 *
 * PREREQUISITE (run automatically unless --skip-ingest is passed):
 *   .venv/Scripts/python.exe -m ingestion.cli \
 *       --dsn postgres://postgres@127.0.0.1:55432/collex_demo \
 *       --corpus evals/fixtures/corpus --apply-migrations
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane, CONTROL_PLANE_ROOT } from "./ts-loader.mjs";

const CONTROL_PLANE_DIR = fileURLToPath(CONTROL_PLANE_ROOT);
const REPO_ROOT = path.resolve(CONTROL_PLANE_DIR, "..");

const DEMO_DB = "collex_demo";
const DEFAULT_DSN = `postgres://postgres@127.0.0.1:55432/${DEMO_DB}`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function defaultPython() {
  const win = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  const posix = path.join(REPO_ROOT, ".venv", "bin", "python");
  return existsSync(win) ? win : posix;
}

function parseArgs(argv) {
  const args = {
    dsn: DEFAULT_DSN,
    out: path.join(REPO_ROOT, "demo-output"),
    keep: false,
    skipIngest: false,
    python: defaultPython(),
    forceDropUploads: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dsn") { args.dsn = argv[++i]; }
    else if (flag === "--out") { args.out = path.resolve(argv[++i]); }
    else if (flag === "--keep") { args.keep = true; }
    else if (flag === "--skip-ingest") { args.skipIngest = true; args.keep = true; }
    else if (flag === "--python") { args.python = argv[++i]; }
    else if (flag === "--force-drop-uploads") { args.forceDropUploads = true; }
    else { throw new Error(`unknown flag: ${flag}`); }
  }
  return args;
}

/**
 * Tenant UPLOAD documents in the demo database (0 when the database or the
 * schema does not exist yet). The fixture corpus' own tenant-scoped dilekçe
 * carries source 'fixture-tenant-upload' (evals/fixtures/corpus/
 * filler_dilekce.json), so only real intake.cli uploads (source 'UPLOAD')
 * count.
 */
export async function countTenantUploads(postgres, dsn) {
  const db = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    const rows = await db`
      select count(*)::int as n from legal.documents
      where scope = 'tenant' and source = 'UPLOAD'`;
    return Number(rows[0]?.n ?? 0);
  } catch (error) {
    // 3D000 database missing, 3F000 schema missing, 42P01 table missing.
    if (error?.code === "3D000" || error?.code === "3F000" || error?.code === "42P01") return 0;
    throw error;
  } finally {
    await db.end({ timeout: 5 });
  }
}

function dbNameOf(dsn) {
  const match = dsn.replace(/^[a-z]+:\/\//i, "").match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// Corpus preparation
// ---------------------------------------------------------------------------

async function recreateDatabase(postgres, dsn) {
  const name = dbNameOf(dsn);
  if (name !== DEMO_DB) {
    throw new Error(
      `refusing to drop ${JSON.stringify(name)}; this script may only recreate ${DEMO_DB}`,
    );
  }
  const adminDsn = dsn.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const admin = postgres(adminDsn, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`drop database if exists ${DEMO_DB} with (force)`);
    await admin.unsafe(
      `create database ${DEMO_DB} template template0 encoding 'UTF8' locale 'C'`,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Run the Python ingestion CLI once (argv array — no shell is involved). */
function runIngestion(python, argv) {
  const result = spawnSync(python, ["-m", "ingestion.cli", ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`corpus ingestion failed (exit ${result.status}):\n${output}`);
  }
  return output.trim();
}

/**
 * Load the fixture corpus in ONE pass, which is what makes S4 meaningful.
 *
 * `FixtureSource` groups files that share an `external_id` and yields EVERY
 * version of a document in commencement order, so this single pass ingests
 * `kanun_5237_v1.json` and then `kanun_5237_v2.json`: the versioning layer
 * appends v2 as a new version of the same logical document and the temporal
 * close-on-append trigger closes v1's effective period at v2's start date.
 * Without both versions the two as_of dates would resolve to the same text
 * and the temporal scenario would prove nothing.
 *
 * A second `--include kanun_5237_v2.json` pass used to run here. Once
 * ingestion learned to yield every version, that pass reported "unchanged"
 * and did nothing; it is gone, and S4 still distinguishes the two versions.
 */
function ingestCorpus(python, dsn) {
  const corpus = path.join("evals", "fixtures", "corpus");
  return runIngestion(python, [
    "--dsn", dsn, "--corpus", corpus, "--apply-migrations",
  ]);
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail: detail === undefined ? "" : String(detail) };
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Slice by Unicode CODE POINTS — the project-wide offset policy. */
function codePointSlice(text, start, end) {
  return Array.from(text).slice(start, end).join("");
}

/**
 * The FULL verification chain for one evidence row, done independently of the
 * control-plane code: hash the canonical text, re-slice the recorded span, and
 * re-hash the result. This is the check a sceptical reader would run.
 */
function verifyEvidenceChain(item, texts) {
  const canonical = texts ? texts[item.documentVersionId] : undefined;
  if (canonical === undefined) return { ok: false, reason: "CANONICAL_TEXT_MISSING" };
  if (sha256Hex(canonical) !== item.contentSha256) {
    return { ok: false, reason: "DOCUMENT_VERSION_MISMATCH" };
  }
  const derived = codePointSlice(canonical, item.startChar, item.endChar);
  if (derived !== item.quote) return { ok: false, reason: "QUOTE_OFFSET_MISMATCH" };
  if (sha256Hex(derived) !== item.quoteSha256) {
    return { ok: false, reason: "QUOTE_HASH_MISMATCH" };
  }
  return { ok: true, reason: "OK" };
}

function findEvidence(answer, predicate) {
  return (answer.evidence || []).find(predicate);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const Q_TCK157 = "TCK m. 157 dolandırıcılık suçunun cezası nedir?";
const Q_UNANSWERABLE =
  "Uzay hukukunda yörünge çarpışma sigortası için hangi tahkim usulü uygulanır?";
const Q_APPLICATION =
  "Araç satışında kapora alındıktan sonra teslim edilmemesi TCK m. 157 " +
  "dolandırıcılık suçunu oluşturur mu?";

const SCENARIOS = [
  {
    id: "S1",
    title: "KAYNAKLI CEVAP (SUPPORTED)",
    expected: "COMPLETE",
    proves:
      "Her tespit, belirli bir belge sürümünün birebir pasajına bağlı; alıntı, " +
      "kanonik metinden kendi code-point konumuyla yeniden üretilebiliyor.",
    async run(env) {
      const answer = await env.answer({ question: Q_TCK157, asOf: "2025-06-01" });
      const bundle = await env.bundle(answer.runId, true);
      const m157 = findEvidence(answer, (e) => e.legislationNo === "5237" && e.article === "157");
      const chains = (answer.evidence || []).map((e) => ({
        evidenceId: e.evidenceId,
        ...verifyEvidenceChain(e, bundle.texts),
      }));
      const badChain = chains.find((c) => !c.ok);
      const supported = (answer.claims || []).filter((c) => c.verdict === "SUPPORTED");
      const uncited = supported.find((c) => (c.evidenceIds || []).length === 0);
      return {
        artifacts: { answer, bundle },
        checks: [
          check("durum COMPLETE", answer.status === "COMPLETE", answer.status),
          check("en az bir kanıt var", (answer.evidence || []).length > 0,
            `${(answer.evidence || []).length} kanıt`),
          check("TCK 5237 m.157 alıntılandı", m157 !== undefined,
            m157 ? m157.documentVersionId : "bulunamadı"),
          check("alıntı 2005 sürümünün cezasını içeriyor",
            m157 !== undefined && m157.quote.includes("bir yıldan beş yıla kadar hapis"),
            m157 ? m157.quote.slice(0, 90) : ""),
          check("her alıntı kanonik metinden yeniden üretildi", badChain === undefined,
            badChain
              ? `${badChain.evidenceId}: ${badChain.reason}`
              : `${chains.length}/${chains.length} zincir doğrulandı`),
          check("desteklenen her tespitin doğrulanmış atfı var", uncited === undefined,
            uncited ? uncited.claimId : `${supported.length} tespit`),
          check("kanıt paketi şeması doğru",
            bundle.schema === "collex.answer.evidence-bundle/v1", bundle.schema),
          // W15: damga "SENTETİK" değil "DENEME BELGELERİ" oldu (avukat sözcüğü).
          // Ölçülen davranış aynı: paket sentetik işaretli VE not gerçek olmadığını yazıyor.
          check("kütüphane DENEME BELGELERİ olarak işaretli",
            bundle.synthetic === true && /DENEME BELGELER/i.test(answer.corpusNotice || ""),
            String(bundle.synthetic)),
        ],
      };
    },
  },

  {
    id: "S2",
    title: "ÇEKİMSER (ABSTENTION)",
    expected: "ABSTAIN",
    proves:
      "Korpusun cevaplayamadığı soruda sistem uydurmuyor: sıfır kaynak kartı, " +
      "sıfır tespit ve dürüst Türkçe bir çekimser metni.",
    async run(env) {
      const answer = await env.answer({ question: Q_UNANSWERABLE, asOf: "2026-06-01" });
      const bundle = await env.bundle(answer.runId, false);
      const md = answer.markdown || "";
      return {
        artifacts: { answer, bundle },
        checks: [
          check("durum ABSTAIN", answer.status === "ABSTAIN", answer.status),
          check("SIFIR kaynak kartı", (answer.evidence || []).length === 0,
            `${(answer.evidence || []).length} kanıt`),
          check("SIFIR tespit", (answer.claims || []).length === 0,
            `${(answer.claims || []).length} tespit`),
          check("kanıt paketi de boş", (bundle.evidence || []).length === 0,
            `${(bundle.evidence || []).length} kanıt`),
          check("Türkçe çekimser metni var",
            md.includes("cevap yazılmadı"), "ABSTENTION_TEXT"),
          check("markdown'da Kaynaklar bölümü yok", !md.includes("## Kaynaklar"), ""),
          check("markdown'da numaralı kaynak kartı yok", !/^### \[\d+\]/m.test(md), ""),
          check("makine gerekçesi NO_EVIDENCE",
            (answer.reasons || []).includes("NO_EVIDENCE"),
            JSON.stringify(answer.reasons || [])),
        ],
      };
    },
  },

  {
    id: "S3",
    title: "ÇELİŞEN OTORİTE (CONTRARY)",
    expected: "CONFLICTING_AUTHORITIES",
    proves:
      "İki sentetik Yargıtay kararının çeliştiği meselede her iki taraf da " +
      "gizlenmeden sunuluyor ve tespitler ÇELİŞEN OTORİTELER olarak işaretleniyor.",
    async run(env) {
      const answer = await env.answer({ question: Q_APPLICATION, asOf: "2026-06-01" });
      const bundle = await env.bundle(answer.runId, false);
      const affirmative = findEvidence(answer, (e) => e.docketNo === "2023/4521");
      const negative = findEvidence(answer, (e) => e.docketNo === "2023/7810");
      const conflicted = (answer.claims || []).filter(
        (c) => c.verdict === "CONFLICTING_AUTHORITIES",
      );
      const cov = answer.contraryCoverage || {};
      return {
        artifacts: { answer, bundle },
        checks: [
          check("karşıt otorite şeritleri çalıştı",
            cov.executed === true && cov.usable === true, `${(cov.lanes || []).length} şerit`),
          check("olumlu karar (E. 2023/4521) kanıt kümesinde", affirmative !== undefined,
            affirmative ? affirmative.polarity : "yok"),
          check("olumsuz karar (E. 2023/7810) kanıt kümesinde", negative !== undefined,
            negative ? negative.polarity : "yok"),
          check("olumsuz karar KARŞIT olarak sınıflandırıldı",
            negative !== undefined && negative.stance === "contrary",
            negative ? `${negative.stance}/${negative.polarity}` : ""),
          check("en az bir tespit ÇELİŞEN OTORİTELER", conflicted.length > 0,
            `${conflicted.length} tespit`),
          check("çelişki kapsam raporunda listelendi",
            (cov.conflictedClaimIds || []).length > 0 &&
            (cov.contraryEvidenceIds || []).length > 0,
            `${(cov.conflictedClaimIds || []).length} tespit / ` +
            `${(cov.contraryEvidenceIds || []).length} karşıt kanıt`),
          check("cevap kesinleştirilmedi, şerh düşüldü",
            answer.status === "QUALIFIED" || answer.status === "PARTIAL", answer.status),
        ],
      };
    },
  },

  {
    id: "S4",
    title: "ZAMANSAL (TEMPORAL)",
    expected: "as_of başına farklı sürüm",
    proves:
      "Aynı soru, 5237 sayılı Kanun'un v1->v2 değişikliğinin iki yakasında " +
      "farklı cevap veriyor ve her cevap o tarihte yürürlükte olan sürümü gösteriyor.",
    async run(env) {
      const before = await env.answer({ question: Q_TCK157, asOf: "2025-06-01" });
      const after = await env.answer({ question: Q_TCK157, asOf: "2026-06-01" });
      const isM157 = (e) => e.legislationNo === "5237" && e.article === "157";
      const a = findEvidence(before, isM157);
      const b = findEvidence(after, isM157);
      return {
        artifacts: { before, after },
        checks: [
          check("2025 cevabı COMPLETE", before.status === "COMPLETE", before.status),
          check("2026 cevabı COMPLETE", after.status === "COMPLETE", after.status),
          check("her iki tarihte de m.157 alıntılandı", a !== undefined && b !== undefined, ""),
          check("iki cevap FARKLI belge sürümü gösteriyor",
            a !== undefined && b !== undefined && a.documentVersionId !== b.documentVersionId,
            a && b ? `${a.documentVersionId} != ${b.documentVersionId}` : ""),
          check("2025: 'bir yıldan beş yıla kadar'",
            a !== undefined && a.quote.includes("bir yıldan beş yıla kadar"),
            a ? a.quote.slice(0, 90) : ""),
          check("2026: 'üç yıldan yedi yıla kadar'",
            b !== undefined && b.quote.includes("üç yıldan yedi yıla kadar"),
            b ? b.quote.slice(0, 90) : ""),
          check("her iki sürüm de kendi tarihinde YÜRÜRLÜKTE",
            a !== undefined && b !== undefined &&
            a.currentness.status === "IN_FORCE" && b.currentness.status === "IN_FORCE",
            a && b ? `${a.currentness.status}/${b.currentness.status}` : ""),
        ],
      };
    },
  },

  {
    id: "S5",
    title: "TAHRİFAT (TAMPER)",
    expected: "atıf reddedilir + kesinleştirilemez",
    proves:
      "Bir alıntının TEK karakteri değiştirildiğinde deterministik doğrulayıcı " +
      "atfı reddediyor, tespit kaynaksıza düşüyor ve cevap kesinleştirilemiyor.",
    async run(env) {
      const run = await env.pipelineRun({ question: Q_TCK157, asOf: "2025-06-01" });
      const target =
        (run.result.evidence || []).find(
          (e) => e.legislationNo === "5237" && e.article === "157",
        ) ?? (run.result.evidence || [])[0];
      if (target === undefined) {
        throw new Error("S5: S1 kanıt üretmediği için tahrifat denemesi yapılamadı");
      }
      const tamper = await env.tamper(run.document, {
        evidenceId: target.evidenceId,
        position: 12,
      });
      const targetClaim = tamper.claims.find(
        (c) => c.claimId === `claim-${target.evidenceId}`,
      );
      return {
        artifacts: {
          question: Q_TCK157,
          asOf: "2025-06-01",
          mode: tamper.mode,
          evidenceId: tamper.evidenceId,
          documentVersionId: tamper.documentVersionId,
          changedCodePoints: tamper.changedCodePoints,
          originalQuote: tamper.originalQuote,
          tamperedQuote: tamper.tamperedQuote,
          originalValidation: tamper.originalValidation,
          tamperedValidation: tamper.tamperedValidation,
          rejectionReason: tamper.rejectionReason,
          statusBefore: tamper.statusBefore,
          statusAfter: tamper.statusAfter,
          finalizableBefore: tamper.finalizableBefore,
          finalizableAfter: tamper.finalizableAfter,
          claims: tamper.claims,
        },
        checks: [
          check("tahrifat öncesi atıf geçerli", tamper.originalValidation.ok === true,
            JSON.stringify(tamper.originalValidation)),
          check("tam olarak BİR karakter değişti", tamper.changedCodePoints === 1,
            String(tamper.changedCodePoints)),
          check("tahrif edilmiş atıf REDDEDİLDİ", tamper.tamperedValidation.ok === false,
            JSON.stringify(tamper.tamperedValidation)),
          check("red gerekçesi QUOTE_OFFSET_MISMATCH",
            tamper.rejectionReason === "QUOTE_OFFSET_MISMATCH", tamper.rejectionReason),
          check("hedef tespit KAYNAKSIZ'a düştü",
            targetClaim !== undefined && targetClaim.after.treatment === "unsupported",
            targetClaim
              ? `${targetClaim.before.treatment} -> ${targetClaim.after.treatment}`
              : "hedef tespit bulunamadı"),
          check("cevap artık kesinleştirilemiyor",
            tamper.finalizableBefore === true && tamper.finalizableAfter === false,
            `${tamper.finalizableBefore} -> ${tamper.finalizableAfter}`),
          check("durum COMPLETE olmaktan çıktı",
            tamper.statusBefore === "COMPLETE" && tamper.statusAfter !== "COMPLETE",
            `${tamper.statusBefore} -> ${tamper.statusAfter}`),
        ],
      };
    },
  },

  {
    id: "S6",
    title: "DOSYA BAĞI (MATTER)",
    expected: "1 cevap + 1 taslak, sürüm 2, UDF deneysel",
    proves:
      "Bir dava dosyası altında verilen cevap ve ondan üretilen taslak dosyaya " +
      "otomatik bağlanıyor; düzenleme yeni sürüm açıyor ve UDF dışa aktarımı " +
      "deneysel başlığıyla dönüyor.",
    async run(env) {
      const matter = await env.json("POST", "/v1/matters", {
        title: "Demo / TCK m.157 (SENTETİK)",
        client: "Sentetik Müvekkil",
        opposing: "Sentetik Karşı Taraf",
        kind: "dava",
      }, 201);
      const answer = await env.answer({ question: Q_TCK157, asOf: "2025-06-01", matterId: matter.id });
      const draft = await env.json("POST", "/v1/drafts", {
        kind: "dilekce",
        template: "dava-dilekcesi",
        matter: {
          matterId: matter.id,
          mahkeme: "İstanbul Nöbetçi Asliye Hukuk Mahkemesi",
          taraflar: [
            { ad: "Sentetik Müvekkil", rol: "Davacı" },
            { ad: "Sentetik Karşı Taraf", rol: "Davalı" },
          ],
          olaylar: [{ tarih: "2025-03-10", metin: "Sentetik bir araç satışı görüşmesi yapılmıştır." }],
          talepler: ["Sentetik alacağın davalıdan tahsiline karar verilmesi"],
        },
        evidence: { runId: answer.runId },
      }, 200);

      // Edit ONE paragraph: resend every section verbatim (ek-dogrulama is
      // machine-owned and regenerated), append a sentence to the first
      // beyan paragraph of the AÇIKLAMALAR section.
      const sections = draft.sections
        .filter((s) => s.id !== "ek-dogrulama")
        .map((s) => ({
          id: s.id,
          paragraphs: s.paragraphs.map((p) => ({
            id: p.id,
            text: p.text,
            evidenceIds: p.evidenceIds,
            role: p.role,
            ...(p.binding !== undefined ? { binding: p.binding } : {}),
          })),
        }));
      const target = sections.find((s) => s.id === "aciklamalar") ?? sections.find((s) => s.paragraphs.length > 0);
      const edited = target.paragraphs.find((p) => p.evidenceIds.length === 0) ?? target.paragraphs[0];
      edited.text = `${edited.text} (Demo S6 düzenlemesi.)`;
      const revised = await env.json("PUT", `/v1/drafts/${draft.draftId}`, { sections, note: "Demo S6" }, 200);

      const page = await env.json("GET", `/v1/matters/${matter.id}`, undefined, 200);
      const versions = await env.json("GET", `/v1/drafts/${draft.draftId}/versions`, undefined, 200);
      const udf = await env.raw("GET", `/v1/drafts/${draft.draftId}/export?format=udf`);
      const answers = page.items?.answers ?? [];
      const drafts = page.items?.drafts ?? [];
      const editedAfter = (revised.sections || [])
        .flatMap((s) => s.paragraphs)
        .find((p) => p.id === edited.id);
      return {
        artifacts: {
          matter,
          answerRunId: answer.runId,
          draftId: draft.draftId,
          draftVersionAfter: revised.version,
          revisionIssues: revised.issues,
          matterPage: page,
          versions,
          udf: { status: udf.status, experimental: udf.headers["x-collex-experimental"] ?? null, bytes: udf.bytes.length },
        },
        checks: [
          check("dosya açıldı (201)", typeof matter.id === "string" && matter.status === "acik", matter.id),
          check("cevap dosyaya bağlandı (1 answer kaydı, refId = runId)",
            answers.length === 1 && answers[0].refId === answer.runId,
            `${answers.length} kayıt`),
          check("cevap kaydı soru/durum taşıyor",
            answers.length === 1 && answers[0].payload.question === Q_TCK157 && answers[0].payload.status === "COMPLETE",
            answers[0] ? `${answers[0].payload.status} / ${answers[0].payload.mode}` : ""),
          check("taslak dosyaya bağlandı (1 draft kaydı, refId = draftId)",
            drafts.length === 1 && drafts[0].refId === draft.draftId,
            `${drafts.length} kayıt`),
          check("PUT yeni sürüm açtı (version 2)", revised.version === 2, String(revised.version)),
          check("düzenlenen paragraf yeni sürümde",
            editedAfter !== undefined && editedAfter.text.endsWith("(Demo S6 düzenlemesi.)"),
            editedAfter ? editedAfter.id : "bulunamadı"),
          check("dosya sayfası taslağın sürüm 2'sini gösteriyor",
            drafts.length === 1 && drafts[0].payload.version === 2,
            drafts[0] ? String(drafts[0].payload.version) : ""),
          check("sürüm geçmişi 2 kayıt", (versions.versions || []).length === 2,
            `${(versions.versions || []).length} sürüm`),
          check("UDF dışa aktarımı 200 + X-ColleX-Experimental",
            udf.status === 200 && udf.headers["x-collex-experimental"] === "udf",
            `${udf.status} / ${udf.headers["x-collex-experimental"] ?? "başlık yok"}`),
          check("UDF bir zip konteyneri (PK)",
            udf.bytes.length > 4 && udf.bytes[0] === 0x50 && udf.bytes[1] === 0x4b,
            `${udf.bytes.length} bayt`),
        ],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function renderReport(results, meta) {
  const lines = [
    "# ColleX kanıt zinciri — demo raporu",
    "",
    "> **SENTETİK TEST VERİSİ.** Bu raporun dayandığı korpus gerçek Türk mevzuatı",
    "> veya içtihadı DEĞİLDİR; `evals/fixtures/corpus` altındaki sentetik test",
    "> metinlerinden oluşur. Buradaki hiçbir sayı hukukî kalite ölçüsü değildir;",
    "> ölçtüğü tek şey mekanizmanın çalışıp çalışmadığıdır. Hukukî işlem için",
    "> kullanılamaz.",
    "",
    `- Çalışma zamanı: ${meta.startedAt}`,
    `- Veritabanı: \`${meta.dbName}\` (yerel scratch Postgres)`,
    `- Korpus: \`evals/fixtures/corpus\` — ${meta.ingested ? "bu çalışmada yeniden yüklendi" : "mevcut veri kullanıldı"}`,
    `- Toplam süre: ${meta.totalMs} ms`,
    "",
    "## Özet",
    "",
    "| Senaryo | Başlık | Beklenen | Sonuç | Kontroller |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const passed = r.checks.filter((c) => c.ok).length;
    lines.push(
      `| ${r.id} | ${r.title} | ${r.expected} | ${r.ok ? "**PASS**" : "**FAIL**"} | ` +
      `${passed}/${r.checks.length} |`,
    );
  }
  lines.push("", "## Senaryolar", "");
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.title} · ${r.ok ? "PASS" : "FAIL"}`, "");
    lines.push(`*Ne kanıtlıyor:* ${r.proves}`, "");
    if (r.error) {
      lines.push("```", `HATA: ${r.error}`, "```", "");
      continue;
    }
    lines.push("| Kontrol | Sonuç | Ayrıntı |", "| --- | --- | --- |");
    for (const c of r.checks) {
      const detail = c.detail.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").slice(0, 160);
      lines.push(`| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${detail} |`);
    }
    lines.push("", `Ham çıktı: \`${r.id}.json\` · süre: ${r.ms} ms`, "");
  }
  lines.push(
    "## Tekrar çalıştırma",
    "",
    "```",
    "node control-plane/scripts/demo.mjs",
    "```",
    "",
    "Betik, herhangi bir senaryo beklenen duruma ulaşamazsa SIFIR OLMAYAN kodla çıkar.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  console.log("ColleX demo — SENTETİK fixture korpusu, yerel scratch Postgres.");
  console.log(`  veritabanı : ${dbNameOf(args.dsn)}`);
  console.log(`  çıktı      : ${args.out}`);

  const postgresModule = await import("postgres");
  const postgres = postgresModule.default;

  let ingested = false;
  if (!args.skipIngest) {
    if (!args.keep) {
      const uploads = await countTenantUploads(postgres, args.dsn);
      if (uploads > 0 && !args.forceDropUploads) {
        console.error(
          `  DURDURULDU: ${dbNameOf(args.dsn)} içinde ${uploads} kiracı yüklemesi (UPLOAD) var;` +
            " demo bu veritabanını silmeyi reddediyor.",
        );
        console.error(
          "  Önce yüklemeleri kaldırın:\n" +
            `    .venv/Scripts/python.exe -m intake.cli --dsn ${args.dsn} --list\n` +
            `    .venv/Scripts/python.exe -m intake.cli --dsn ${args.dsn} --delete <fileId>\n` +
            "  ya da bilerek silmek için: node control-plane/scripts/demo.mjs --force-drop-uploads",
        );
        return 3;
      }
      console.log("  [1/4] veritabanı yeniden oluşturuluyor...");
      await recreateDatabase(postgres, args.dsn);
    }
    console.log("  [2/4] fixture korpusu yükleniyor (Python ingestion CLI)...");
    const output = ingestCorpus(args.python, args.dsn);
    ingested = true;
    for (const line of output.split(/\r?\n/)) console.log(`        ${line}`);
  } else {
    console.log("  [1-2/4] ingest atlandı (--skip-ingest)");
  }

  console.log("  [3/4] cevap hattı ve HTTP yüzeyi kuruluyor...");
  const { createDb } = await importControlPlane("src/store/db.ts");
  const { createStoreRetrievalPort, createStoreTextPort, createStoreVersionFactsPort } =
    await importControlPlane("src/pipeline/storeAdapters.ts");
  const { AnswerPipeline } = await importControlPlane("src/pipeline/answerPipeline.ts");
  const { runTamperCheck } = await importControlPlane("src/pipeline/tamper.ts");
  const { createApp } = await importControlPlane("src/api/server.ts");

  const sql = createDb({ url: args.dsn });
  const pipeline = new AnswerPipeline({
    retrieval: createStoreRetrievalPort(sql),
    texts: createStoreTextPort(sql),
    versionFacts: createStoreVersionFactsPort(sql),
    producer: "collex demo (control-plane/scripts/demo.mjs)",
  });

  // Corpus-only app: no upstream provider gateway is configured, so /v1/search
  // answers 503 and nothing in this run can reach the network. Matters,
  // drafts and answers use the in-memory stores (this is a test, not the
  // product store); the UDF export shells to the venv exporter (S6).
  const app = createApp({
    answerPipeline: pipeline,
    python: { path: args.python, repoRoot: REPO_ROOT },
    dbName: dbNameOf(args.dsn),
  });

  const env = {
    /** JSON round-trip with an expected status (S6). */
    async json(method, url, payload, expectedStatus) {
      const res = await app.request(url, {
        method,
        ...(payload !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
          : {}),
      });
      const text = await res.text();
      const body = text === "" ? undefined : JSON.parse(text);
      if (res.status !== expectedStatus) {
        throw new Error(`${method} ${url} -> ${res.status} (beklenen ${expectedStatus}): ${text.slice(0, 400)}`);
      }
      return body;
    },
    /** Raw bytes + headers (S6 udf export). */
    async raw(method, url) {
      const res = await app.request(url, { method });
      const headers = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      return { status: res.status, headers, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async answer(payload) {
      const res = await app.request("/v1/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.status !== 200) {
        throw new Error(`POST /v1/answer -> ${res.status}: ${JSON.stringify(body)}`);
      }
      return body;
    },
    async bundle(runId, withTexts) {
      const res = await app.request(
        `/v1/answers/${runId}/evidence-bundle${withTexts ? "?texts=true" : ""}`,
      );
      const body = await res.json();
      if (res.status !== 200) {
        throw new Error(`GET evidence-bundle -> ${res.status}: ${JSON.stringify(body)}`);
      }
      return body;
    },
    pipelineRun: (payload) => pipeline.answer(payload),
    tamper: (document, options) => runTamperCheck(document, options),
  };

  console.log("  [4/4] senaryolar çalıştırılıyor...");
  mkdirSync(args.out, { recursive: true });

  const results = [];
  for (const scenario of SCENARIOS) {
    const started = Date.now();
    let outcome;
    try {
      outcome = await scenario.run(env);
    } catch (error) {
      results.push({
        id: scenario.id,
        title: scenario.title,
        expected: scenario.expected,
        proves: scenario.proves,
        ok: false,
        checks: [],
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
      });
      continue;
    }
    const ms = Date.now() - started;
    const record = {
      id: scenario.id,
      title: scenario.title,
      expected: scenario.expected,
      proves: scenario.proves,
      ok: outcome.checks.every((c) => c.ok),
      checks: outcome.checks,
      ms,
    };
    results.push(record);
    writeFileSync(
      path.join(args.out, `${scenario.id}.json`),
      `${JSON.stringify({ ...record, artifacts: outcome.artifacts }, null, 2)}\n`,
      "utf8",
    );
  }

  const totalMs = Date.now() - t0;
  writeFileSync(
    path.join(args.out, "report.md"),
    renderReport(results, { startedAt, dbName: dbNameOf(args.dsn), ingested, totalMs }),
    "utf8",
  );
  writeFileSync(
    path.join(args.out, "summary.json"),
    `${JSON.stringify(
      {
        startedAt,
        totalMs,
        database: dbNameOf(args.dsn),
        synthetic: true,
        syntheticNotice:
          "SENTETİK TEST VERİSİ — gerçek Türk mevzuatı veya içtihadı değildir.",
        scenarios: results.map((r) => ({
          id: r.id,
          title: r.title,
          expected: r.expected,
          ok: r.ok,
          passed: r.checks.filter((c) => c.ok).length,
          total: r.checks.length,
          ...(r.error !== undefined ? { error: r.error } : {}),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await sql.end({ timeout: 5 });

  const width = Math.max(...SCENARIOS.map((s) => s.title.length));
  console.log("");
  console.log(`  ${"KOD".padEnd(4)} ${"SENARYO".padEnd(width)}  DURUM   KONTROL`);
  console.log(`  ${"-".repeat(4)} ${"-".repeat(width)}  ------  -------`);
  for (const r of results) {
    const passed = r.checks.filter((c) => c.ok).length;
    console.log(
      `  ${r.id.padEnd(4)} ${r.title.padEnd(width)}  ` +
      `${(r.ok ? "PASS" : "FAIL").padEnd(6)}  ${passed}/${r.checks.length}`,
    );
    if (!r.ok) {
      if (r.error) console.log(`         ! ${r.error}`);
      for (const c of r.checks.filter((x) => !x.ok)) {
        console.log(`         ! ${c.name} — ${c.detail}`);
      }
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`  rapor: ${path.join(args.out, "report.md")}`);
  console.log(
    failed.length === 0
      ? `  SONUÇ: ${results.length}/${results.length} senaryo beklenen duruma ulaştı.`
      : `  SONUÇ: ${failed.length} senaryo BAŞARISIZ (${failed.map((r) => r.id).join(", ")}).`,
  );
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(`demo failed: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
