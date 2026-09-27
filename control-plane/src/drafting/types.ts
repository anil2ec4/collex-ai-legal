/**
 * Drafting contracts (Master Build Brief section 11.5, drafting half;
 * W12 lane C — drafting v2: court-ready structure, versions, evidence
 * discipline, UDF export).
 *
 * A Draft is an evidence-disciplined document skeleton: every paragraph
 * declares whether it is (a) a party statement / contractual will
 * ("beyan/İRADE" — needs no evidence), (b) a legal assertion BOUND to
 * validated evidence (carries `evidenceIds`, each one present in the draft's
 * own evidence list), or (c) a legal assertion WITHOUT verified backing —
 * `supported:false`, loudly marked KAYNAKSIZ and counted in
 * `unsupportedCount`. Nothing is ever silently included and no citation is
 * ever fabricated: an evidence id may only be attached when the paragraph's
 * text lexically contains the quoted passage (see composer.ts,
 * `evidenceOverlaps`).
 *
 * The same JSON travels over HTTP (`POST /v1/drafts` response), into the
 * draft store, into the TS Markdown renderer and into the Python DOCX/UDF
 * exporters (`export/petition.py`, `export/udf.py`), which re-verify the
 * evidence closure before writing a single byte.
 *
 * W12 additions are ADDITIVE: `version`, `matterId`, `unusedEvidence`,
 * `suggestedFacts`, `updatedAt`, paragraph `binding`, the HMK m.119 party
 * fields, `DraftMatter.{mahkeme,esasNo,davaDegeri,arabuluculuk,vekil,tarih}`
 * and the `ek-dogrulama` section. Old consumers ignore them.
 */

import type { ReviewMark } from "./exportMode.js";

export type { ReviewMark };

/** Single-user local mode tenant (RLS bypass via superuser is documented). */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** Schema id carried by every draft (additive; the wire contract's body). */
export const DRAFT_SCHEMA = "collex.draft/v1" as const;

/**
 * Mandatory review banner. FIRST line of the Markdown export, first-page
 * banner and per-page footer of the DOCX export (export/petition.py keeps
 * the same wording — change both or neither).
 */
export const DRAFT_REVIEW_BANNER =
  "Bu taslak makine üretimidir; avukat incelemesi zorunludur.";

/** Note on paragraphs that state facts, party identity or contractual will. */
export const NOTE_BEYAN = "beyan/İRADE — kanıt gerektirmez";

/** Note on legal assertions that could NOT be bound to verified evidence. */
export const NOTE_KAYNAKSIZ =
  "KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli";

/** Note on paragraphs whose text is bound to validated evidence. */
export const NOTE_KAYNAKLI = "doğrulanmış kaynağa bağlı";

/** Note on the machine-owned verification appendix paragraphs (W12). */
export const NOTE_DOGRULAMA = "doğrulama bilgisi — belge gövdesine ait değildir";

/**
 * Note carried by every paragraph written from the lawyer's own free-text
 * account ("Olayı kendi cümlelerinizle anlatın", W16 şerit E).
 *
 * ADR-021 governs it exactly as it governs an uploaded document: the account
 * is the lawyer's OWN STATEMENT. It may stand in AÇIKLAMALAR / OLAY ÖZETİ,
 * it is marked `supported:false` there, and it can never back a hukukî
 * değerlendirme paragraph or become a Dayanak.
 */
export const NOTE_OLAY_ANLATISI =
  "olay anlatısı (sizin beyanınız) — doğrulanmış bir kaynağa bağlı değildir";

/**
 * Note on the single sentence that fills a MANDATORY aleyhe (karşı içtihat)
 * section when the draft's own sources contain nothing against the request.
 * It is a report about THIS document's sources, never a legal assessment.
 */
export const NOTE_ALEYHE_YOK =
  "bu bölüm boş bırakılamaz — satır, bu belgeye bağlanan kaynakların taranmasının sonucudur";

/**
 * The fixed sentence of an empty aleyhe section (W16 şerit E).
 *
 * The honesty point is the second half. The composer sees ONLY the sources
 * bound to this draft; it did not search an archive. Writing "arşivde aleyhe
 * kaynak yok" would be a claim about a search that never ran — so the
 * sentence says what was looked at, and says that absence is not proof.
 */
export const ALEYHE_KAYNAK_YOK_TEXT =
  "Bu belgeye bağlanan kaynaklar arasında talebin aksi yönünde (aleyhe) bir kaynak" +
  " yoktur. Bu, aleyhe kaynak bulunmadığı anlamına gelmez: burada yalnızca bu belgeye" +
  " bağlanan kaynaklara bakılmıştır, ayrıca bir aleyhe kaynak araması yapılmamıştır." +
  " Aleyhe kaynak araştırmasını avukat yapmalıdır.";

/**
 * Fixed note carried by EVERY paragraph of the karşı içtihat section
 * (cross-lane contract A — the console and the DOCX exporter display it
 * verbatim; change all surfaces or none).
 */
export const NOTE_KARSIT =
  "Bu karar talebin aksi yönündedir; dilekçeye alınıp alınmayacağına avukat karar verir.";

/** Section id/title of the contrary-authority section (contract A). */
export const KARSI_ICTIHAT_SECTION_ID = "karsi-ictihat";
export const KARSI_ICTIHAT_SECTION_TITLE = "DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT";

/**
 * Fixed sentence appended to a supporting-side assessment paragraph when the
 * answer run was CONFLICTED (W12 contract [D]). Same wording on every
 * surface.
 */
export const CONFLICT_POINTER_SENTENCE =
  "Aksi yönde karar için DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT bölümüne bakınız.";

/** Section id/title of the machine-owned verification appendix (W12). */
export const EK_DOGRULAMA_SECTION_ID = "ek-dogrulama";
export const EK_DOGRULAMA_SECTION_TITLE = "EK — DOĞRULAMA BİLGİLERİ";

/**
 * Human direction of one evidence entry relative to the matter's request
 * (cross-lane contract A; additive). Values are the SHARED dictionary's
 * Turkish words — raw enums (supporting/contrary/neutral) never reach a
 * user-facing surface.
 */
export type DraftEvidenceDirection = "destekleyen" | "karşıt" | "yön belirtmez";

/** Map an answer-pipeline stance onto the user-facing direction word. */
export function directionOfStance(stance: string | undefined): DraftEvidenceDirection {
  if (stance === "supporting") return "destekleyen";
  if (stance === "contrary") return "karşıt";
  return "yön belirtmez";
}

/** Visible marker prefixed to every unsupported paragraph in exports. */
export const KAYNAKSIZ_PREFIX = "⚠ KAYNAKSIZ";

/**
 * The KAYNAKSIZ STUB sentences a mandatory legal slot gets when nothing could
 * be bound (27.09.2026: named constants, because the NİHAİ copy must refuse
 * while one is still in the text — each is an instruction to the lawyer, not
 * court text, and `marks=none` printed it as plain body text).
 */
export const KAYNAKSIZ_STUB_SEBEPLER =
  "Hukukî sebepler doğrulanmış bir mevzuat veya karar kaynağına bağlanamadı;" +
  " dayanak mevzuat avukat tarafından eklenmelidir.";
export const KAYNAKSIZ_STUB_DEGERLENDIRME_KAYNAK_YOK =
  "Hukukî değerlendirme için doğrulanmış kaynak sunulmamıştır; bu bölümün" +
  " hukukî dayanağı avukat tarafından eklenmelidir.";
export const KAYNAKSIZ_STUB_DEGERLENDIRME_ESIK =
  "Sunulan kaynaklardan hiçbiri doğrulama eşiğini geçemedi; hukukî" +
  " değerlendirme avukat tarafından tamamlanmalıdır.";
export const KAYNAKSIZ_STUBS: readonly string[] = Object.freeze([
  KAYNAKSIZ_STUB_SEBEPLER,
  KAYNAKSIZ_STUB_DEGERLENDIRME_KAYNAK_YOK,
  KAYNAKSIZ_STUB_DEGERLENDIRME_ESIK,
]);

export type DraftKind = "dilekce" | "sozlesme";

/**
 * What a template slot renders; also stamped on paragraphs as `role`.
 * "karsiIctihat" and "ekDogrulama" are not template slots: they are the
 * roles of the composer-appended karşı içtihat / doğrulama sections.
 * Renderers that do not know a role fall back to body styling — additive by
 * construction.
 */
export type SlotKind =
  | "baslik"
  | "taraflar"
  | "konu"
  | "olaylar"
  | "arabuluculuk"
  | "hukukiDegerlendirme"
  | "hukukiSebepler"
  | "deliller"
  | "talepler"
  | "imza"
  | "hukum"
  | "liste"
  | "karsiIctihat"
  | "ekDogrulama";

/** Every SlotKind value, for runtime validation of edited paragraphs. */
export const SLOT_KINDS: readonly SlotKind[] = [
  "baslik",
  "taraflar",
  "konu",
  "olaylar",
  "arabuluculuk",
  "hukukiDegerlendirme",
  "hukukiSebepler",
  "deliller",
  "talepler",
  "imza",
  "hukum",
  "liste",
  "karsiIctihat",
  "ekDogrulama",
];

/** Roles whose paragraphs are legal assertions (need evidence or KAYNAKSIZ). */
export const LEGAL_ROLES: ReadonlySet<SlotKind> = new Set<SlotKind>([
  "hukukiDegerlendirme",
  "hukukiSebepler",
]);

/**
 * How an evidence id got attached to a paragraph (W12, additive).
 * "lexical" = the paragraph text lexically contains the quote (the
 * composer's anti-fabrication rule); an entailment binding names the judge
 * that vouched for it and is accepted ONLY on trusted server-side paths.
 */
export type DraftBinding =
  | "lexical"
  | { kind: "entailment"; score: number; judge: string };

export interface DraftParagraph {
  id: string;
  text: string;
  /** Ids into the draft's own `evidence` list — never anywhere else. */
  evidenceIds: string[];
  /**
   * true  — beyan/İRADE (no evidence needed) OR evidence-bound legal text;
   * false — a legal assertion without verified backing (KAYNAKSIZ).
   */
  supported: boolean;
  note?: string;
  /** Which template slot produced this paragraph (additive; styling hint). */
  role: SlotKind;
  /** Additive (W12): how the evidence ids were bound (absent = lexical). */
  binding?: DraftBinding;
  /**
   * Additive (27.09.2026): the exact SYSTEM placeholder strings this paragraph
   * still carries — "[Kararın özeti — doldurun]", a template's
   * "[DAVANIN GÖRÜLDÜĞÜ]" address, or a whole KAYNAKSIZ stub sentence
   * ("… avukat tarafından eklenmelidir."). A token counts only while it is
   * still present in `text`; the NİHAİ (filing) copy is refused while any is
   * (see `placeholders.ts`). Absent = none. Never set from user input.
   */
  placeholders?: string[];
}

export interface DraftSection {
  id: string;
  /** Empty string = unheaded block (court address line, signature block). */
  title: string;
  paragraphs: DraftParagraph[];
}

/** EvidenceView-like entry: identity + integrity of one citable passage. */
export interface DraftEvidence {
  evidenceId: string;
  /** Human citation label (mahkeme / "5237 sayılı ..." / başlık + E./K./m.). */
  label: string;
  source: string;
  title: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  article?: string;
  quote: string;
  /** SHA-256 hex over the UTF-8 bytes of `quote`. */
  quoteSha256: string;
  /** SHA-256 hex over the UTF-8 bytes of the full canonical source text. */
  contentSha256: string;
  /**
   * Additive (contract A): which way this evidence points relative to the
   * request — "destekleyen" | "karşıt" | "yön belirtmez". "karşıt" evidence
   * NEVER renders under HUKUKÎ SEBEPLER as a Dayanak; it lives in the
   * karşı içtihat section instead. Absent on drafts produced before this
   * field existed (old consumers ignore it; new consumers treat absence as
   * "yön belirtmez").
   */
  direction?: DraftEvidenceDirection;
  /** Additive (W12): uploaded-document provenance (source "UPLOAD" only). */
  fileId?: string;
  chunkId?: string;
  /**
   * Additive (W12-FIX2, relevance gate): why the composer parked this entry
   * in `unusedEvidence` — its field of law does not fit the template
   * (DOMAIN_MISMATCH) or its text shares no content word with the matter
   * (NOT_RELEVANT). Absent on entries in `evidence` and on entries that are
   * merely uncited. `evidenceUse:true` on PUT overrides the gate.
   */
  unusedReason?: "DOMAIN_MISMATCH" | "NOT_RELEVANT";
}

/**
 * Where a fact suggestion came from (additive, W16 şerit E). Absent on
 * suggestions produced before this field existed — those are all upload
 * suggestions, so an old reader that ignores the field is still right.
 */
export type DraftFactSource = "yuklenen-belge" | "olay-anlatisi";

/**
 * A fact-like sentence OFFERED to the lawyer — never inserted (W12: found in
 * an uploaded document; W16 şerit E: found in the lawyer's own free-text
 * account). `fileId`/`chunkId` identify the uploaded passage a suggestion
 * came from and are therefore ABSENT on an account-derived suggestion: an
 * account has no file and no passage, and inventing one would be a fabricated
 * provenance.
 */
export interface DraftSuggestedFact {
  /** GG.AA.YYYY when a date was found in the sentence. */
  tarih?: string;
  metin: string;
  /** Uploaded-document provenance; absent for `kaynak: "olay-anlatisi"`. */
  fileId?: string;
  chunkId?: string;
  /** Additive (W16): absent means "yuklenen-belge" (the only old source). */
  kaynak?: DraftFactSource;
}

export interface Draft {
  schema: typeof DRAFT_SCHEMA;
  draftId: string;
  kind: DraftKind;
  template: string;
  /** Template display title (additive; used as the document heading). */
  title: string;
  createdAt: string;
  /** Additive (W12): set by every revision (GET returns the latest). */
  updatedAt?: string;
  /** Additive (W12): 1 for a new draft; PUT /v1/drafts/{id} increments. */
  version: number;
  /** Additive (W12): owning matter, when the request named one. */
  matterId?: string | null;
  /** ALWAYS true — a machine draft is never final (brief 11.5). */
  reviewRequired: true;
  sections: DraftSection[];
  /** Evidence entries cited by the document (closure set) + uploaded exhibits. */
  evidence: DraftEvidence[];
  /**
   * Additive (W12): validated entries the document does NOT use (not cited
   * by any usable claim, not referenced by the matter text). Never rendered;
   * a reviewer can pull one in with `evidenceUse` on PUT.
   */
  unusedEvidence: DraftEvidence[];
  /** Additive (W12): fact-like sentences from uploads — never auto-inserted. */
  suggestedFacts: DraftSuggestedFact[];
  /** Number of paragraphs with `supported:false` (KAYNAKSIZ legal claims). */
  unsupportedCount: number;
  warnings: string[];
  /**
   * Additive: machine-audience diagnostics (claim ids, raw verdict enums).
   * `warnings` stays human Turkish; nothing here is meant for the lawyer.
   */
  machineWarnings?: string[];
  /** True when any bound evidence comes from the SENTETİK fixture corpus. */
  synthetic: boolean;
  syntheticNotice?: string;
  /**
   * Additive (W14 · B-36): the lawyer's pre-filing review record, keyed by
   * the ids in `exportMode.ts::REVIEW_CHECKLIST_ITEMS`. Carried across
   * versions, persisted with the draft, printed into the audit report.
   * The honesty boundary is fixed: this is not OUR verification, it is the
   * record that the LAWYER verified.
   */
  reviewChecklist?: Record<string, ReviewMark>;
  /**
   * Additive (W14 · B-36): per-evidence review record (evidenceId -> mark),
   * so "who looked at K-3, when, with what note" survives to the next month.
   */
  evidenceReview?: Record<string, ReviewMark>;
}

// ---------------------------------------------------------------------------
// Request contract (wire shape of POST /v1/drafts, mirrored by zod in routes)
// ---------------------------------------------------------------------------

/** A lawyer (vekil) — HMK m.119/1-ç. */
export interface DraftVekil {
  ad: string;
  baro?: string;
  sicilNo?: string;
  adres?: string;
}

/** HMK m.119 party block: identity number, address, counsel. */
export interface DraftParty {
  ad: string;
  rol: string;
  /** T.C. kimlik numarası (11 haneli). */
  tckn?: string;
  /** Vergi kimlik numarası (tüzel kişi; 10 haneli). */
  vkn?: string;
  adres?: string;
  vekil?: DraftVekil;
}

export interface DraftEvent {
  tarih?: string;
  metin: string;
}

export interface DraftArabuluculuk {
  yapildi: boolean;
  /** YYYY-MM-DD or GG.AA.YYYY; rendered GG.AA.YYYY. */
  tarih?: string;
  sonuc?: string;
}

export interface DraftMatter {
  baslik?: string;
  /** Hitap edilen mahkeme/merci (başlık satırı verilmediğinde '…'NE olarak). */
  mahkeme?: string;
  /** Dosya / esas numarası (cevap, istinaf, temyiz, icra itirazı). */
  esasNo?: string;
  /** HMK m.119/1-d — dava değeri (malvarlığı hakları). */
  davaDegeri?: string;
  arabuluculuk?: DraftArabuluculuk;
  /** Matter-level counsel; signature block source (fallback: a party's vekil). */
  vekil?: DraftVekil;
  /** Owning matter workspace id (persisted on the draft). */
  matterId?: string | null;
  /** Document date, YYYY-MM-DD or GG.AA.YYYY; rendered GG.AA.YYYY (default: now). */
  tarih?: string;
  taraflar: DraftParty[];
  olaylar: DraftEvent[];
  talepler: string[];
  ekBilgiler?: Record<string, unknown>;
}

export interface DraftEvidenceRequest {
  runId?: string;
  fileIds?: string[];
}

export interface DraftRequest {
  kind: DraftKind;
  template: string;
  matter: DraftMatter;
  evidence?: DraftEvidenceRequest;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Evidence resolution inputs (dependency-injected by the API integration)
// ---------------------------------------------------------------------------

/** One claim usable for evidence-bound paragraphs (RuleBasedDrafter output). */
export interface DraftClaim {
  claimId: string;
  /** Citation label + verbatim quotes — never invented prose. */
  text: string;
  evidenceIds: string[];
  /**
   * Additive (W12): the answer run found contrary authority for this claim.
   * The composer writes the supporting side and appends the fixed pointer
   * sentence to the karşı içtihat section.
   */
  conflicted?: boolean;
}

/** Uploaded-document summary carried by the pack (W12; one per file). */
export interface DraftUploadInfo {
  fileId: string;
  fileName: string;
  contentSha256: string;
  chunkCount: number;
}

/** Resolved, validated evidence handed to the composer. */
export interface DraftEvidencePack {
  claims: DraftClaim[];
  evidence: DraftEvidence[];
  synthetic: boolean;
  syntheticNotice?: string;
  /** Additive (W12): fact-like sentences found in uploads. */
  suggestedFacts?: DraftSuggestedFact[];
  /** Additive (W12): per-file upload summaries (deliller + doğrulama lines). */
  uploads?: DraftUploadInfo[];
}

/**
 * The slice of a stored `collex.answer.result/v1` the drafting lane consumes.
 * `InMemoryAnswerStore` entries satisfy this structurally.
 */
export interface AnswerResultLike {
  runId: string;
  claims: ReadonlyArray<{
    claimId: string;
    text: string;
    /** Evidence ids that passed deterministic validation. */
    evidenceIds: readonly string[];
    verdict: string;
    /** Additive: contrary-side evidence ids (present on stored answers). */
    contraryEvidenceIds?: readonly string[];
  }>;
  evidence: ReadonlyArray<{
    evidenceId: string;
    source: string;
    sourceUrl?: string;
    title: string;
    court?: string;
    decisionDate?: string;
    docketNo?: string;
    decisionNo?: string;
    legislationNo?: string;
    article?: string;
    quote: string;
    quoteSha256: string;
    contentSha256: string;
    /** Additive: pipeline stance ("supporting" | "contrary" | "neutral"). */
    stance?: string;
    /**
     * Additive (W12-FIX): how retrieval reached the passage. `pinned` is
     * the exact-reference lane's match on the question's own citation; in
     * an answer that HAS a pinned passage every other one is context (the
     * console folds them under "Bağlam için getirilen komşu hükümler") and
     * never seeds a hukukî değerlendirme or a Dayanak.
     */
    retrieval?: { pinned?: boolean };
  }>;
  bundle?: { synthetic?: boolean; syntheticNotice?: string };
}

export interface StoredAnswerLike {
  result: AnswerResultLike;
}

/**
 * Lookup for `evidence.runId` (the API's answer store satisfies this).
 * `warm` (W12, contract [P]) lets a persistent store load a run that is not
 * in its cache before `get` is consulted.
 */
export interface DraftAnswerLookup {
  get(runId: string): StoredAnswerLike | undefined;
  warm?(runId: string): Promise<void>;
}

/** One chunk of an uploaded (tenant) document, as the files lane stores it. */
export interface DraftFileChunk {
  fileId: string;
  fileName: string;
  chunkId: string;
  ordinal: number;
  /** Exact canonical chunk text (code-point offsets into the file text). */
  text: string;
  startChar: number;
  endChar: number;
  /** SHA-256 hex over the UTF-8 bytes of the file's full extracted text. */
  contentSha256: string;
}

/** Port for `evidence.fileIds` (implemented by the upload lane). */
export interface DraftingFilePort {
  getChunks(fileIds: readonly string[], tenantId: string): Promise<DraftFileChunk[]>;
}
