/**
 * Evidence resolution for drafts: turns `{runId?, fileIds?}` into a
 * `DraftEvidencePack` the composer can bind paragraphs to.
 *
 *  - `runId` — reuses the claims a stored `collex.answer.result/v1` already
 *    carries (they were drafted by RuleBasedDrafter and went through the
 *    deterministic citation validator). Claims whose verdict still stands
 *    (SUPPORTED / QUALIFIED / PARTIAL_SOURCE_COVERAGE) are reused as they
 *    are; CONFLICTING_AUTHORITIES claims are reused as CONFLICTED claims
 *    (W12): the composer writes their supporting side and points at the
 *    karşı içtihat section. Stale or unsupported claims are reported in
 *    warnings instead of silently becoming dilekçe prose.
 *  - `fileIds` — chunks of the tenant's uploaded documents (supplied by the
 *    injected `DraftingFilePort`) become evidence entries (source "UPLOAD",
 *    fileId/chunkId carried) so the DELİLLER lines and the doğrulama section
 *    can describe them by file — and NOTHING ELSE: an uploaded document is
 *    an exhibit, never a hukukî değerlendirme (W12, audit #4). Fact-like
 *    sentences with dates/amounts are offered as `suggestedFacts` for the
 *    lawyer to pick from; they are never inserted automatically.
 *
 * Unknown runId / fileIds and missing ports are ISSUES (the API answers a
 * typed 400): referring to evidence that cannot be produced must fail
 * loudly, not degrade into an unsourced draft.
 */

import { legislationLabel } from "../answer/evidencePack.js";
import { deterministicEvidenceId } from "../answer/evidencePack.js";
import { sha256HexUtf8 } from "../verification/validator.js";
import type { FieldIssue } from "./templates.js";
import type {
  AnswerResultLike,
  DraftAnswerLookup,
  DraftClaim,
  DraftEvidence,
  DraftEvidencePack,
  DraftEvidenceRequest,
  DraftFileChunk,
  DraftSuggestedFact,
  DraftUploadInfo,
  DraftingFilePort,
} from "./types.js";
import { LOCAL_TENANT_ID, directionOfStance } from "./types.js";
import { formatDateTr } from "./input.js";

/** Verdicts whose claims may be reused as draft paragraphs unchanged. */
const REUSABLE_VERDICTS = new Set(["SUPPORTED", "QUALIFIED", "PARTIAL_SOURCE_COVERAGE"]);

/** Verdict reused as a CONFLICTED claim (supporting side written, pointer added). */
const CONFLICTED_VERDICT = "CONFLICTING_AUTHORITIES";

/** Upper bound on suggested facts per draft (a long file must not flood the form). */
export const MAX_SUGGESTED_FACTS = 25;

export interface ResolveDeps {
  answers?: DraftAnswerLookup;
  files?: DraftingFilePort;
  now?: () => Date;
}

export interface ResolvedDraftEvidence {
  pack?: DraftEvidencePack;
  /** Request-level problems; non-empty means the API must answer 400. */
  issues: FieldIssue[];
  /** Human Turkish warnings — no claim ids, no raw verdict enums. */
  warnings: string[];
  /** Machine-audience diagnostics (claim ids + raw verdicts), for the JSON. */
  machineWarnings: string[];
}

/** Citation label from evidence metadata only (mirrors citeLabel; dates GG.AA.YYYY). */
export function draftEvidenceLabel(entry: {
  title: string;
  court?: string;
  legislationNo?: string;
  docketNo?: string;
  decisionNo?: string;
  decisionDate?: string;
  article?: string;
}): string {
  const parts: string[] = [];
  if (entry.court !== undefined && entry.court !== "") parts.push(entry.court);
  else if (entry.legislationNo !== undefined && entry.legislationNo !== "") {
    // Shared builder: never "7999 sayılı 7999 sayılı ..." (contract E).
    parts.push(legislationLabel(entry.legislationNo, entry.title));
  } else parts.push(entry.title);
  if (entry.docketNo !== undefined && entry.docketNo !== "") parts.push(`E. ${entry.docketNo}`);
  if (entry.decisionNo !== undefined && entry.decisionNo !== "") {
    parts.push(`K. ${entry.decisionNo}`);
  }
  if (entry.decisionDate !== undefined && entry.decisionDate !== "") {
    parts.push(`T. ${formatDateTr(entry.decisionDate)}`);
  }
  if (entry.article !== undefined && entry.article !== "") parts.push(`m. ${entry.article}`);
  return parts.join(", ");
}

/** Short human reference for one evidence entry ("E. 2023/7810" or label). */
function shortRef(entry: { docketNo?: string; label: string }): string {
  return entry.docketNo !== undefined && entry.docketNo !== ""
    ? `E. ${entry.docketNo}`
    : entry.label;
}

/** Dedupe + cap a reference list for a one-sentence warning. */
function refList(refs: readonly string[]): string {
  return [...new Set(refs)].slice(0, 3).join(", ");
}

/**
 * ONE aggregate human sentence per verdict (critic #7). Claim ids and raw
 * enums never appear here — they live in `machineWarnings`.
 */
function skippedClaimsWarning(verdict: string, count: number): string {
  const reason =
    verdict === "INSUFFICIENT_EVIDENCE"
      ? "doğrulanmış kanıtı bulunmadığı için"
      : verdict === "OUT_OF_DATE_SOURCE"
        ? "dayandığı kaynak güncel olmadığı için"
        : "doğrulama kontrolünden geçemediği için";
  return (
    `${count} hukukî değerlendirme, ${reason} taslağa yazılmadı;` +
    " değerlendirme avukata bırakıldı."
  );
}

/** Human sentence for the conflicted claims that WERE written (W12). */
function conflictedClaimsWarning(
  count: number,
  supportingRefs: readonly string[],
  contraryRefs: readonly string[],
): string {
  const sides =
    supportingRefs.length > 0 && contraryRefs.length > 0
      ? `: ${refList(supportingRefs)} talebi destekler yönünde, ` +
        `${refList(contraryRefs)} talebin aksi yönündedir`
      : "";
  return (
    `${count} hukukî değerlendirme için kaynaklar arasında çelişki bulundu${sides}.` +
    " Destekleyen taraf taslağa yazıldı ve her paragrafa karşı içtihat işareti eklendi;" +
    " aksi yöndeki karar DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT bölümündedir —" +
    " değerlendirme avukata bırakıldı."
  );
}

function fromStoredAnswer(result: AnswerResultLike): {
  claims: DraftClaim[];
  evidence: DraftEvidence[];
  warnings: string[];
  machineWarnings: string[];
} {
  const warnings: string[] = [];
  const machineWarnings: string[] = [];
  const claims: DraftClaim[] = [];

  const evidence: DraftEvidence[] = result.evidence.map((entry) => {
    const view: DraftEvidence = {
      evidenceId: entry.evidenceId,
      label: entry.source === "UPLOAD" ? entry.title : draftEvidenceLabel(entry),
      source: entry.source,
      title: entry.title,
      quote: entry.quote,
      quoteSha256: entry.quoteSha256,
      contentSha256: entry.contentSha256,
      direction: directionOfStance(entry.stance),
    };
    if (entry.court !== undefined) view.court = entry.court;
    if (entry.decisionDate !== undefined) view.decisionDate = entry.decisionDate;
    if (entry.docketNo !== undefined) view.docketNo = entry.docketNo;
    if (entry.decisionNo !== undefined) view.decisionNo = entry.decisionNo;
    if (entry.legislationNo !== undefined) view.legislationNo = entry.legislationNo;
    if (entry.article !== undefined) view.article = entry.article;
    return view;
  });
  const byId = new Map(evidence.map((entry) => [entry.evidenceId, entry]));

  // W12-FIX (02.09.2026): in an answer that has a PINNED passage (the
  // question's own citation), a claim resting only on non-pinned passages is
  // a neighbour provision brought in for context — the answer itself shows
  // it folded as "Bağlam için getirilen komşu hükümler". Reused as a
  // hukukî değerlendirme it became a green Dayanak: a kira cevap dilekçesi
  // drafted from a TCK m.157 research argued TCK m.155/156/158/159/168.
  // Such claims are not reused; their evidence stays available in
  // unusedEvidence for the lawyer to add deliberately.
  const pinnedIds = new Set(
    result.evidence.filter((entry) => entry.retrieval?.pinned === true).map((entry) => entry.evidenceId),
  );
  let contextClaims = 0;

  // Skipped claims are aggregated per verdict into ONE human sentence each;
  // the claim-id detail goes to machineWarnings (critic #7).
  const skipped = new Map<string, number>();
  const conflicted = { count: 0, supportingRefs: [] as string[], contraryRefs: [] as string[] };
  for (const claim of result.claims) {
    if (claim.evidenceIds.length === 0) continue;
    if (pinnedIds.size > 0 && !claim.evidenceIds.some((id) => pinnedIds.has(id))) {
      contextClaims += 1;
      machineWarnings.push(
        `Cevaptaki ${claim.claimId} tespiti komşu hüküm (bağlam) olduğu için taslağa alınmadı (CONTEXT_ONLY).`,
      );
      continue;
    }
    if (claim.verdict === CONFLICTED_VERDICT) {
      machineWarnings.push(
        `Cevaptaki ${claim.claimId} tespiti '${claim.verdict}': destekleyen taraf taslağa alındı, karşı içtihat ayrı bölümde.`,
      );
      conflicted.count += 1;
      for (const id of claim.evidenceIds) {
        const entry = byId.get(id);
        if (entry !== undefined && entry.direction !== "karşıt") {
          conflicted.supportingRefs.push(shortRef(entry));
        }
      }
      for (const id of claim.contraryEvidenceIds ?? []) {
        const entry = byId.get(id);
        if (entry !== undefined) conflicted.contraryRefs.push(shortRef(entry));
      }
      claims.push({
        claimId: claim.claimId,
        text: claim.text,
        evidenceIds: [...claim.evidenceIds],
        conflicted: true,
      });
      continue;
    }
    if (!REUSABLE_VERDICTS.has(claim.verdict)) {
      machineWarnings.push(
        `Cevaptaki ${claim.claimId} tespiti '${claim.verdict}' olduğu için taslağa alınmadı.`,
      );
      skipped.set(claim.verdict, (skipped.get(claim.verdict) ?? 0) + 1);
      continue;
    }
    claims.push({
      claimId: claim.claimId,
      text: claim.text,
      evidenceIds: [...claim.evidenceIds],
    });
  }
  if (conflicted.count > 0) {
    // A conflict with no recorded contrary side still names the contrary
    // evidence entries themselves, when the pack carries any.
    if (conflicted.contraryRefs.length === 0) {
      conflicted.contraryRefs.push(
        ...evidence.filter((e) => e.direction === "karşıt").map(shortRef),
      );
    }
    warnings.push(
      conflictedClaimsWarning(conflicted.count, conflicted.supportingRefs, conflicted.contraryRefs),
    );
  }
  for (const [verdict, count] of skipped) {
    warnings.push(skippedClaimsWarning(verdict, count));
  }
  if (contextClaims > 0) {
    warnings.push(
      `${contextClaims} tespit, sorunun doğrudan dayanağı olmayan komşu hükümlere dayandığı için` +
        " hukukî değerlendirmeye ve HUKUKÎ SEBEPLER'e yazılmadı (bağlam için getirilmişlerdi)." +
        " Gerekirse düzenleme ekranından (kanıt kullanımı) bilerek eklenebilir.",
    );
  }

  return { claims, evidence, warnings, machineWarnings };
}

// ---------------------------------------------------------------------------
// Uploaded documents: exhibits + suggested facts (never legal prose)
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, string>> = Object.freeze({
  ocak: "01",
  şubat: "02",
  mart: "03",
  nisan: "04",
  mayıs: "05",
  haziran: "06",
  temmuz: "07",
  ağustos: "08",
  eylül: "09",
  ekim: "10",
  kasım: "11",
  aralık: "12",
});

const DATE_NUMERIC = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)|(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/u;
const DATE_WORDS =
  /(?<!\d)(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})(?!\d)/iu;
const FACT_CUES =
  /(?<![\p{L}])(tarihinde|tebliğ|ihtar|ödeme|ödenm|ödedi|sözleşme|fatura|teslim|imzalan|başvur|tahsil|temerrüt|ihbar|fesih|TL)(?![\p{L}])/iu;

/** GG.AA.YYYY for the first date found in a sentence, if any. */
export function extractDateTr(sentence: string): string | undefined {
  const numeric = sentence.match(DATE_NUMERIC);
  if (numeric !== null) {
    if (numeric[1] !== undefined) {
      return formatDateTr(`${numeric[1]}.${numeric[2]}.${numeric[3]}`);
    }
    return formatDateTr(`${numeric[4]}-${numeric[5]}-${numeric[6]}`);
  }
  const words = sentence.match(DATE_WORDS);
  if (words !== null) {
    const month = MONTHS[(words[2] as string).toLocaleLowerCase("tr-TR")];
    if (month !== undefined) {
      return `${(words[1] as string).padStart(2, "0")}.${month}.${words[3]}`;
    }
  }
  return undefined;
}

/**
 * Fact-like sentences of uploaded chunks: a sentence that carries a date,
 * an amount or a procedural cue word. Offered to the lawyer; never inserted.
 */
export function extractSuggestedFacts(chunks: readonly DraftFileChunk[]): DraftSuggestedFact[] {
  const out: DraftSuggestedFact[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const sentences = chunk.text
      .replace(/\s+/gu, " ")
      .split(/(?<=[.!?])\s+/u)
      .map((s) => s.trim())
      .filter((s) => s.length >= 15 && s.length <= 400);
    for (const sentence of sentences) {
      const tarih = extractDateTr(sentence);
      if (tarih === undefined && !FACT_CUES.test(sentence)) continue;
      const key = sentence.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) continue;
      seen.add(key);
      const fact: DraftSuggestedFact = { metin: sentence, fileId: chunk.fileId, chunkId: chunk.chunkId };
      if (tarih !== undefined) fact.tarih = tarih;
      out.push(fact);
      if (out.length >= MAX_SUGGESTED_FACTS) return out;
    }
  }
  return out;
}

/** Materialize uploaded-file chunks as evidence entries (one per chunk). */
function fileChunkEntries(chunks: readonly DraftFileChunk[]): DraftEvidence[] {
  return chunks.map((chunk) => ({
    evidenceId: deterministicEvidenceId(`upload:${chunk.fileId}`, chunk.startChar, chunk.endChar),
    label: chunk.fileName,
    source: "UPLOAD",
    title: chunk.fileName,
    quote: chunk.text,
    quoteSha256: sha256HexUtf8(chunk.text),
    contentSha256: chunk.contentSha256,
    // Uploaded documents state facts, not a direction on the claim.
    direction: "yön belirtmez",
    fileId: chunk.fileId,
    chunkId: chunk.chunkId,
  }));
}

/** One summary per uploaded file, in first-seen order. */
function uploadSummaries(chunks: readonly DraftFileChunk[]): DraftUploadInfo[] {
  const byFile = new Map<string, DraftUploadInfo>();
  for (const chunk of chunks) {
    const existing = byFile.get(chunk.fileId);
    if (existing !== undefined) {
      existing.chunkCount += 1;
      continue;
    }
    byFile.set(chunk.fileId, {
      fileId: chunk.fileId,
      fileName: chunk.fileName,
      contentSha256: chunk.contentSha256,
      chunkCount: 1,
    });
  }
  return [...byFile.values()];
}

/**
 * Resolve the request's evidence sources into one merged pack. Returns
 * `pack: undefined` when the request named no source at all.
 */
export async function resolveDraftEvidence(
  evidence: DraftEvidenceRequest | undefined,
  deps: ResolveDeps,
): Promise<ResolvedDraftEvidence> {
  if (evidence === undefined || (evidence.runId === undefined && evidence.fileIds === undefined)) {
    return { issues: [], warnings: [], machineWarnings: [] };
  }

  const issues: FieldIssue[] = [];
  const warnings: string[] = [];
  const machineWarnings: string[] = [];
  const claims: DraftClaim[] = [];
  const entries: DraftEvidence[] = [];
  let synthetic = false;
  let syntheticNotice: string | undefined;
  let suggestedFacts: DraftSuggestedFact[] = [];
  let uploads: DraftUploadInfo[] = [];

  if (evidence.runId !== undefined) {
    if (deps.answers === undefined) {
      issues.push({
        path: "evidence.runId",
        message: "cevap deposu bu örnekte yapılandırılmamış; runId kanıtı kullanılamaz",
      });
    } else {
      // Contract [P]: a persistent store may need to load the run first.
      await deps.answers.warm?.(evidence.runId);
      const stored = deps.answers.get(evidence.runId);
      if (stored === undefined) {
        issues.push({
          path: "evidence.runId",
          message: `çalışma bulunamadı: ${evidence.runId}`,
        });
      } else {
        const mapped = fromStoredAnswer(stored.result);
        claims.push(...mapped.claims);
        entries.push(...mapped.evidence);
        warnings.push(...mapped.warnings);
        machineWarnings.push(...mapped.machineWarnings);
        if (stored.result.bundle?.synthetic === true) {
          synthetic = true;
          syntheticNotice = stored.result.bundle.syntheticNotice;
        }
      }
    }
  }

  if (evidence.fileIds !== undefined && evidence.fileIds.length > 0) {
    if (deps.files === undefined) {
      issues.push({
        path: "evidence.fileIds",
        message: "dosya deposu bu örnekte yapılandırılmamış; dosya kanıtı kullanılamaz",
      });
    } else {
      // 27.09.2026: Ek-n numbering follows the LAWYER's order — the order of
      // `evidence.fileIds` — never the store's. The Pg port used to answer in
      // `external_id` (hex fileId) order, so "Ek-1" was whichever file hashed
      // lowest. Stable sort: a file's chunks keep their ordinal order.
      const position = new Map(evidence.fileIds.map((fileId, index) => [fileId, index] as const));
      const chunks = [...(await deps.files.getChunks(evidence.fileIds, LOCAL_TENANT_ID))].sort(
        (a, b) =>
          (position.get(a.fileId) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.fileId) ?? Number.MAX_SAFE_INTEGER),
      );
      const seenFileIds = new Set(chunks.map((chunk) => chunk.fileId));
      for (const fileId of evidence.fileIds) {
        if (!seenFileIds.has(fileId)) {
          issues.push({ path: "evidence.fileIds", message: `dosya bulunamadı: ${fileId}` });
        }
      }
      if (chunks.length > 0) {
        // Exhibits + suggested facts only. NO claims: an uploaded document
        // never becomes a hukukî değerlendirme paragraph (audit #4).
        entries.push(...fileChunkEntries(chunks));
        uploads = uploadSummaries(chunks);
        suggestedFacts = extractSuggestedFacts(chunks);
        warnings.push(
          `${uploads.length} yüklenen belge delil (Ek-n) olarak listelendi; belge içeriği hukukî` +
            " değerlendirmeye yazılmadı (yüklenen belge hukukî dayanak değildir).",
        );
      }
    }
  }

  if (issues.length > 0) return { issues, warnings, machineWarnings };

  const packOut: DraftEvidencePack = { claims, evidence: entries, synthetic };
  if (syntheticNotice !== undefined) packOut.syntheticNotice = syntheticNotice;
  if (suggestedFacts.length > 0) packOut.suggestedFacts = suggestedFacts;
  if (uploads.length > 0) packOut.uploads = uploads;
  return { pack: packOut, issues: [], warnings, machineWarnings };
}
