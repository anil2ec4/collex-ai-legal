/**
 * Matter auto-linking (W12 integration, contract [M]).
 *
 * When a request names a matter (`matterId` on POST /v1/answer, POST
 * /v1/research[/start], `matter.matterId` on POST /v1/drafts, the multipart
 * `matterId` field on POST /v1/files) the server files the produced record
 * under that matter as a `matter_item`:
 *
 *   answer  refId = runId    payload { question, status, mode }
 *   draft   refId = draftId  payload { title, template, version }
 *   file    refId = fileId   payload { fileName }
 *
 * Two rules, both enforced here so every route behaves the same:
 *
 *   1. A matter that does not exist is a typed 404 MATTER_NOT_FOUND BEFORE
 *      the work starts (`MatterLinker.exists`), so a mistyped id never
 *      silently produces an orphan. A store that cannot answer is a 503
 *      STORE_UNAVAILABLE, never a silent skip.
 *   2. Linking never fails the primary request. A link that fails after the
 *      record exists is reported as a warning in the response body
 *      (`MATTER_LINK_FAILED:<Turkish>`) and on stderr; the record itself is
 *      already created and can be filed by hand.
 *
 * The link is keyed by (kind, refId): a second put of the same record (a
 * draft revision, a re-persisted answer) UPDATES the existing item instead
 * of adding a duplicate, and concurrent puts for the same key are serialized.
 *
 * `linkedAnswerStore` / `linkedDraftStore` are thin wrappers that forward
 * every store method and start a link on `put` when the entry carries a
 * matterId — that is how the research router's sink (lane F) and the AI
 * router's `drafts.put` (lane E) link without knowing about matters.
 */

import { summarizeStoredAnswer, type AnswerStore, type StoredAnswer } from "./answerService.js";
import type { DraftStore } from "../drafting/store.js";
import type { Draft } from "../drafting/types.js";
import { isUuid } from "../matters/store.js";
import type { MatterItem, MatterItemKind, MatterStore } from "../matters/types.js";

export const MATTER_LINK_FAILED = "MATTER_LINK_FAILED";
export const MATTER_LINK_FAILED_MESSAGE_TR =
  "Kayıt dava dosyasına bağlanamadı; kaydın kendisi oluşturuldu, dosyaya elle ekleyebilirsiniz.";
export const MATTER_NOT_FOUND_MESSAGE_TR = "Dava dosyası bulunamadı; matterId alanını kontrol edin.";
export const MATTER_STORE_UNAVAILABLE_MESSAGE_TR =
  "Yerel veritabanına ulaşılamadı; dava dosyası doğrulanamadığı için işlem yapılmadı.";

/** The three record kinds the server files automatically. */
export type LinkKind = Extract<MatterItemKind, "answer" | "draft" | "file">;

export interface LinkOutcome {
  ok: boolean;
  item?: MatterItem;
  /** `MATTER_LINK_FAILED:<Turkish>` when `ok` is false. */
  warning?: string;
}

export type MatterExistence = "ok" | "missing" | "unavailable";

/** The warning string appended to a response whose link failed. */
export function matterLinkWarning(): string {
  return `${MATTER_LINK_FAILED}:${MATTER_LINK_FAILED_MESSAGE_TR}`;
}

/** How many settled link outcomes `settle` can still report after the fact. */
export const RECENT_LINK_OUTCOMES = 128;

export class MatterLinker {
  private readonly pending = new Map<string, Promise<LinkOutcome>>();
  /**
   * Outcomes of links that already settled, newest last, bounded. Needed
   * because the routes that report a link (the /v1/research middleware, the
   * drafts PUT middleware, the research router's `settleLink`) ask AFTER the
   * handler answered, and an in-memory link settles within a few microtasks
   * — before that, `settle` only saw the in-flight job and a fast failure
   * was silently lost (found 02.09.2026 by the failing-store test).
   */
  private readonly recent = new Map<string, LinkOutcome>();
  private readonly log: (line: string) => void;

  constructor(
    private readonly store: MatterStore,
    log?: (line: string) => void,
  ) {
    this.log = log ?? ((line) => process.stderr.write(`${line}\n`));
  }

  /** Pre-check for a request that names a matter (never throws). */
  async exists(matterId: string): Promise<MatterExistence> {
    if (!isUuid(matterId)) return "missing";
    try {
      return (await this.store.get(matterId)) === undefined ? "missing" : "ok";
    } catch {
      return "unavailable";
    }
  }

  /**
   * File a record under a matter (create or update the item). Never
   * rejects; the returned outcome says whether it worked. Calls for the
   * same (kind, refId) run one after another.
   */
  link(
    matterId: string,
    kind: LinkKind,
    refId: string,
    payload: Record<string, unknown>,
  ): Promise<LinkOutcome> {
    const key = `${kind}:${refId}`;
    const previous: Promise<unknown> = this.pending.get(key) ?? Promise.resolve();
    const job: Promise<LinkOutcome> = previous
      .then(() => this.upsert(matterId, kind, refId, payload))
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : typeof error;
        const code =
          typeof (error as { code?: unknown } | null)?.code === "string"
            ? ` code=${(error as { code: string }).code}`
            : "";
        this.log(`[collex] ${MATTER_LINK_FAILED} kind=${kind} refId=${refId} matterId=${matterId} ${name}${code}`);
        return { ok: false, warning: matterLinkWarning() };
      });
    this.pending.set(key, job);
    // A new link for the same record supersedes whatever it reported before.
    this.recent.delete(key);
    void job.then((outcome) => {
      if (this.pending.get(key) === job) this.pending.delete(key);
      this.remember(key, outcome);
    });
    return job;
  }

  /**
   * The link of one record: the in-flight job while it runs, else the
   * outcome it settled with (bounded memory, newest RECENT_LINK_OUTCOMES);
   * undefined when this record was never linked.
   */
  async settle(kind: LinkKind, refId: string): Promise<LinkOutcome | undefined> {
    const key = `${kind}:${refId}`;
    return this.pending.get(key) ?? this.recent.get(key);
  }

  private remember(key: string, outcome: LinkOutcome): void {
    this.recent.delete(key);
    this.recent.set(key, outcome);
    while (this.recent.size > RECENT_LINK_OUTCOMES) {
      const oldest = this.recent.keys().next();
      if (oldest.done === true) break;
      this.recent.delete(oldest.value);
    }
  }

  private async upsert(
    matterId: string,
    kind: LinkKind,
    refId: string,
    payload: Record<string, unknown>,
  ): Promise<LinkOutcome> {
    const items = await this.store.listItems(matterId);
    const existing = items.find((item) => item.kind === kind && item.refId === refId);
    const item =
      existing !== undefined
        ? await this.store.updateItem(matterId, existing.itemId, {
            payload: { ...existing.payload, ...payload },
          })
        : await this.store.addItem(matterId, { kind, refId, payload });
    if (item === undefined) throw new Error("MATTER_NOT_FOUND");
    return { ok: true, item };
  }
}

/**
 * Contract [M] payload of an `answer` item. `fileScope` (W12-API2) is
 * denormalized into the item only when the answer was asked over uploads,
 * so the "Belge" label survives an answer-store cache miss.
 */
export function answerLinkPayload(entry: StoredAnswer): Record<string, unknown> {
  const summary = summarizeStoredAnswer(entry);
  return {
    question: summary.question,
    status: summary.status,
    mode: summary.mode,
    ...(summary.fileScope !== undefined ? { fileScope: summary.fileScope } : {}),
  };
}

/** Contract [M] payload of a `draft` item. */
export function draftLinkPayload(draft: Draft): Record<string, unknown> {
  return {
    title: draft.title,
    template: draft.template,
    version: typeof draft.version === "number" ? draft.version : 1,
  };
}

/**
 * AnswerStore wrapper: forwards everything; a `put` whose entry carries a
 * string `matterId` starts a link (awaitable through `linker.settle`).
 */
export function linkedAnswerStore(inner: AnswerStore, linker: MatterLinker): AnswerStore {
  const store: AnswerStore = {
    put(entry: StoredAnswer): void {
      inner.put(entry);
      if (typeof entry.matterId === "string" && entry.matterId !== "") {
        void linker.link(entry.matterId, "answer", entry.runId, answerLinkPayload(entry));
      }
    },
    get(runId: string): StoredAnswer | undefined {
      return inner.get(runId);
    },
  };
  if (inner.warm !== undefined) store.warm = (runId) => inner.warm!(runId);
  if (inner.list !== undefined) store.list = (opts) => inner.list!(opts);
  if (inner.attach !== undefined) store.attach = (runId, matterId) => inner.attach!(runId, matterId);
  if (inner.persisted !== undefined) store.persisted = (runId) => inner.persisted!(runId);
  // W14 L-FIX: same omission as the draft wrapper below, same consequence —
  // `DELETE /v1/answers/{runId}` (B-26) answered 501 through the mounted app
  // although both stores implement `remove`. Asking the same question twice
  // left two rows nobody could remove, which is the defect B-26 named.
  if (inner.remove !== undefined) store.remove = (runId) => inner.remove!(runId);
  return store;
}

/**
 * DraftStore wrapper: forwards put/get/warm/list/versions; a `put` of a
 * draft with a string `matterId` links it (version and title refreshed).
 */
export function linkedDraftStore(inner: DraftStore, linker: MatterLinker): DraftStore {
  const store: DraftStore = {
    put(draft: Draft): void {
      inner.put(draft);
      if (typeof draft.matterId === "string" && draft.matterId !== "") {
        void linker.link(draft.matterId, "draft", draft.draftId, draftLinkPayload(draft));
      }
    },
    get(draftId: string): Draft | undefined {
      return inner.get(draftId);
    },
  };
  if (inner.warm !== undefined) store.warm = (draftId) => inner.warm!(draftId);
  if (inner.list !== undefined) store.list = (opts) => inner.list!(opts);
  if (inner.persisted !== undefined) store.persisted = (draftId) => inner.persisted!(draftId);
  if (inner.detachMatter !== undefined) store.detachMatter = (matterId) => inner.detachMatter!(matterId);
  if (inner.versions !== undefined) {
    // Contract [P] as the HTTP route documents it: ascending by version.
    // InMemoryDraftStore already is; PgDraftStore reads highest-first, so
    // the wire order is pinned HERE and cannot depend on the store wired.
    store.versions = async (draftId) =>
      [...(await inner.versions!(draftId))].sort((a, b) => a.version - b.version);
  }
  // W14 L-FIX. These two were NOT forwarded, and the wrapper is what every
  // router actually receives — so `DELETE /v1/drafts/{id}` and
  // `GET /v1/drafts/{id}/versions/{n}` answered 501 "kalıcı depo bağlı değil"
  // even against a real PostgreSQL that implemented both. The lane report
  // recorded this as a memory-mode gap (W14-L-MATTER.md item 12.8); it was in
  // fact total, and invisible because `PgDraftStore` was only ever unit-tested
  // directly. A wrapper that forwards SOME of an interface is how a working
  // implementation gets reported as missing.
  if (inner.remove !== undefined) store.remove = (draftId) => inner.remove!(draftId);
  if (inner.getVersionBody !== undefined) {
    store.getVersionBody = (draftId, version) => inner.getVersionBody!(draftId, version);
  }
  return store;
}
