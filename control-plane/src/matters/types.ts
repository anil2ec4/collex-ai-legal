/**
 * Matters ("Davalarım") — the workspace unit of a solo lawyer (W12-A,
 * contract [M]).
 *
 * A matter (dava dosyası) groups everything about one dispute: uploaded
 * files, saved answers, drafts, notes, timeline events and deadlines. Items
 * are polymorphic rows with a `kind`, an optional `refId` into another store
 * (fileId / runId / draftId) and a jsonb `payload` whose conventions are
 * fixed here and validated by the router (matters/routes.ts):
 *
 *   file      { fileName }
 *   answer    { question, status, mode, fileScope? }   (fileScope: W12-API2,
 *               only for an answer asked over uploads)
 *   draft     { title, template, version }
 *   note      { text, source: 'manual' | 'ai' | 'belge:<fileId>' }
 *   event     { date: 'YYYY-MM-DD', title, source: 'manual' |
 *               'belge:<fileId>' | 'belge:<fileId>:<chunkId>', verified: boolean }
 *               (two-segment form: W12-API2 — a date the upload analysis
 *               found without a chunk identity)
 *   deadline  { title, dueDate: 'YYYY-MM-DD', ruleId?, startDate?, computed?,
 *               status: 'acik' | 'tamam', source: 'manual' | 'hesap' }
 *   hearing   { date: 'YYYY-MM-DD', time: 'HH:MM', court, salon,
 *               kind: 'durusma' | 'kesif' | 'e-durusma', note,
 *               status: 'planlandi' | 'yapildi' | 'ertelendi' }   (W14 B-17)
 *
 * Dates travel as ISO 'YYYY-MM-DD' on the wire (machine form); every
 * user-facing surface renders GG.AA.YYYY.
 *
 * W14 (B-17): `hearing` is the litigator's most critical calendar object and
 * was missing entirely. It follows the `deadline` pattern one-for-one so the
 * calendar and the .ics feed can render both from one derivation path.
 * NOTE: `app_private.matter_items.kind` carries a CHECK constraint that does
 * NOT yet list 'hearing'; the DDL is in the L-MATTER report's
 * integrationRequests (L-SAFE owns migrations). Until it is applied the Pg
 * store answers a typed Turkish error instead of a driver stack trace.
 */

import { foldTurkishForFilter } from "../retrieval/normalize.js";

export const MATTER_KINDS = ["dava", "danismanlik", "sozlesme", "icra", "diger"] as const;
export type MatterKind = (typeof MATTER_KINDS)[number];

export const MATTER_STATUSES = ["acik", "beklemede", "kapali"] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const MATTER_ITEM_KINDS = [
  "file",
  "answer",
  "draft",
  "note",
  "event",
  "deadline",
  "hearing",
] as const;
export type MatterItemKind = (typeof MATTER_ITEM_KINDS)[number];

/** Hearing sub-kinds (machine codes stay ASCII; labels are Turkish). */
export const HEARING_KINDS = ["durusma", "kesif", "e-durusma"] as const;
export type HearingKind = (typeof HEARING_KINDS)[number];

export const HEARING_STATUSES = ["planlandi", "yapildi", "ertelendi"] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];

export const HEARING_KIND_LABELS: Record<HearingKind, string> = {
  durusma: "Duruşma",
  kesif: "Keşif",
  "e-durusma": "e-Duruşma",
};

export const HEARING_STATUS_LABELS: Record<HearingStatus, string> = {
  planlandi: "Planlandı",
  yapildi: "Yapıldı",
  ertelendi: "Ertelendi",
};

export const MATTER_ITEM_KIND_LABELS: Record<MatterItemKind, string> = {
  file: "Belge",
  answer: "Araştırma",
  draft: "Taslak",
  note: "Not",
  event: "Olay",
  deadline: "Süre",
  hearing: "Duruşma",
};

/** Turkish labels for the console (machine codes stay English). */
export const MATTER_KIND_LABELS: Record<MatterKind, string> = {
  dava: "Dava",
  danismanlik: "Danışmanlık",
  sozlesme: "Sözleşme",
  icra: "İcra",
  diger: "Diğer",
};

export const MATTER_STATUS_LABELS: Record<MatterStatus, string> = {
  acik: "Açık",
  beklemede: "Beklemede",
  kapali: "Kapalı",
};

export interface Matter {
  id: string;
  title: string;
  client: string;
  opposing: string;
  court: string;
  docketNo: string;
  kind: MatterKind;
  status: MatterStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatterCounts {
  files: number;
  answers: number;
  drafts: number;
  notes: number;
  events: number;
  deadlines: number;
  /** Additive (W14 B-17). */
  hearings: number;
}

export interface NextDeadline {
  itemId: string;
  title: string;
  dueDate: string;
  /**
   * Additive (W14 B-26): whole days from `today` to `dueDate` (negative when
   * the date has passed) and whether it has passed. The console showed a
   * 49-day-overdue date as "sonraki süre" because neither field existed.
   */
  daysLeft: number;
  overdue: boolean;
}

/** Additive (W14 B-17): the matter's next planned hearing. */
export interface NextHearing {
  itemId: string;
  title: string;
  date: string;
  time: string;
  kind: HearingKind;
  daysLeft: number;
}

/** GET /v1/matters row: the matter plus derived workspace facts. */
export interface MatterSummary {
  id: string;
  title: string;
  client: string;
  opposing: string;
  court: string;
  docketNo: string;
  kind: MatterKind;
  status: MatterStatus;
  createdAt: string;
  updatedAt: string;
  counts: MatterCounts;
  /**
   * Earliest OPEN deadline that has NOT passed (W14 B-26). An overdue
   * deadline is real work, but it is not the NEXT one; it is counted in
   * `overdueCount` and listed by GET /v1/matters/deadlines instead. When
   * every open deadline is overdue this is null and `overdueCount` > 0.
   */
  nextDeadline: NextDeadline | null;
  /** Additive (W14 B-26): open deadlines whose dueDate is before today. */
  overdueCount: number;
  /** Additive (W14 B-17): earliest planned hearing on or after today. */
  nextHearing: NextHearing | null;
  /** Latest of the matter's own updatedAt and every item's updatedAt. */
  lastActivityAt: string;
}

export interface MatterItem {
  itemId: string;
  matterId: string;
  kind: MatterItemKind;
  refId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type DeadlineRow = MatterItem & { matterTitle: string };

export interface NewMatter {
  title: string;
  client?: string;
  opposing?: string;
  court?: string;
  docketNo?: string;
  kind?: MatterKind;
  status?: MatterStatus;
  notes?: string;
}

export type MatterPatch = Partial<NewMatter>;

export interface NewMatterItem {
  kind: MatterItemKind;
  refId?: string | null;
  payload?: Record<string, unknown>;
}

export interface MatterItemPatch {
  /** Full replacement (the router merges before calling the store). */
  payload?: Record<string, unknown>;
  refId?: string | null;
}

export interface MatterItemsByKind {
  files: MatterItem[];
  answers: MatterItem[];
  drafts: MatterItem[];
  notes: MatterItem[];
  events: MatterItem[];
  deadlines: MatterItem[];
  /** Additive (W14 B-17). */
  hearings: MatterItem[];
}

/**
 * One row of GET /v1/matters/{id}/activity (W14 B-43): "nerede kalmıştım".
 * `at` is the item's updatedAt; `href` is the console anchor for the row.
 */
export interface ActivityEntry {
  itemId: string;
  kind: MatterItemKind;
  refId: string | null;
  title: string;
  at: string;
  /** Turkish label of `kind` (MATTER_ITEM_KIND_LABELS). */
  kindLabel: string;
}

/**
 * Persistence port. Both implementations (PgMatterStore, InMemoryMatterStore)
 * return plain Matter/MatterItem rows; the derived summary is computed by
 * `deriveMatterSummary` below so the two cannot disagree.
 */
export interface MatterStore {
  /** `today` (ISO) decides `nextDeadline` / `overdueCount` (W14 B-26). */
  list(opts?: { status?: MatterStatus; q?: string; today?: string }): Promise<MatterSummary[]>;
  create(input: NewMatter): Promise<Matter>;
  get(id: string): Promise<Matter | undefined>;
  update(id: string, patch: MatterPatch): Promise<Matter | undefined>;
  remove(id: string): Promise<boolean>;
  listItems(matterId: string): Promise<MatterItem[]>;
  getItem(matterId: string, itemId: string): Promise<MatterItem | undefined>;
  /** `undefined` when the matter does not exist. */
  addItem(matterId: string, input: NewMatterItem): Promise<MatterItem | undefined>;
  updateItem(matterId: string, itemId: string, patch: MatterItemPatch): Promise<MatterItem | undefined>;
  removeItem(matterId: string, itemId: string): Promise<boolean>;
  /**
   * Open deadlines across every matter, due date ascending. `from` (W14 B-26)
   * drops the ones already past; `until` caps the window (the route defaults
   * it to today + 30 days so the panel stops shipping data it never shows).
   */
  listDeadlines(opts?: { until?: string; from?: string }): Promise<DeadlineRow[]>;
  /**
   * Additive (W14 B-17): planned hearings across every matter, date ascending.
   * Optional so a store written before this wave still satisfies the port.
   */
  listHearings?(opts?: { until?: string; from?: string }): Promise<DeadlineRow[]>;
  /**
   * Additive (W14 B-18): file up to MAX_BATCH_ITEMS records in ONE request.
   * Returns the created items in input order; a store without it falls back
   * to sequential `addItem` calls in the router.
   */
  addItems?(matterId: string, inputs: readonly NewMatterItem[]): Promise<MatterItem[] | undefined>;
  /**
   * Additive (W14 B-29): items of ANY matter whose payload text contains `q`
   * (note text, event/deadline/hearing titles). Newest first.
   */
  searchItems?(opts: {
    q: string;
    kinds?: readonly MatterItemKind[];
    limit?: number;
  }): Promise<DeadlineRow[]>;
}

/** Cap on one `items:batch` request (W14 B-18). */
export const MAX_BATCH_ITEMS = 50;

// ---------------------------------------------------------------------------
// Pure helpers shared by both stores
// ---------------------------------------------------------------------------

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** True for a `deadline` item that is still open (status !== 'tamam'). */
export function isOpenDeadline(item: MatterItem): boolean {
  if (item.kind !== "deadline") return false;
  const status = item.payload["status"];
  const due = item.payload["dueDate"];
  return status !== "tamam" && typeof due === "string" && ISO_DATE_RE.test(due);
}

/**
 * True for a `hearing` item that is still PLANNED (status planlandi, or no
 * status). 27.09.2026: a hearing PATCHed to "ertelendi" used to stay the
 * matter's `nextHearing` on its OLD date — the lawyer's card announced a
 * hearing that will not take place. A postponed hearing is not next.
 */
export function isPlannedHearing(item: MatterItem): boolean {
  if (item.kind !== "hearing") return false;
  const status = item.payload["status"];
  const date = item.payload["date"];
  return (
    (status === undefined || status === "planlandi") &&
    typeof date === "string" &&
    ISO_DATE_RE.test(date)
  );
}

/**
 * True for a `hearing` item the calendar and the `.ics` feed still carry:
 * planned OR postponed (not yet held). A postponed one stays in the feed on
 * purpose — as a CANCELLED event, so a subscribed calendar REMOVES the old
 * entry instead of keeping it as confirmed (see `ics.ts`).
 */
export function isCalendarHearing(item: MatterItem): boolean {
  if (item.kind !== "hearing") return false;
  const status = item.payload["status"];
  const date = item.payload["date"];
  return status !== "yapildi" && typeof date === "string" && ISO_DATE_RE.test(date);
}

/**
 * Whole days from `from` to `to`, both ISO 'YYYY-MM-DD', calendar-exact.
 * UTC midnight arithmetic: no clock, no timezone, no DST — the two dates are
 * civil dates, not instants. Negative when `to` is in the past.
 */
export function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const ISTANBUL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's civil date in Türkiye (Europe/Istanbul), ISO form. 27.09.2026: it
 * was the UTC date, three hours behind the lawyer's wall clock — between
 * 00:00 and 03:00 a deadline due "today" counted as tomorrow's and a hearing
 * of today as still ahead by a day.
 */
export function todayIso(now: Date = new Date()): string {
  return ISTANBUL_DAY.format(now);
}

export function groupItems(items: readonly MatterItem[]): MatterItemsByKind {
  const grouped: MatterItemsByKind = {
    files: [],
    answers: [],
    drafts: [],
    notes: [],
    events: [],
    deadlines: [],
    hearings: [],
  };
  for (const item of items) {
    switch (item.kind) {
      case "file":
        grouped.files.push(item);
        break;
      case "answer":
        grouped.answers.push(item);
        break;
      case "draft":
        grouped.drafts.push(item);
        break;
      case "note":
        grouped.notes.push(item);
        break;
      case "event":
        grouped.events.push(item);
        break;
      case "deadline":
        grouped.deadlines.push(item);
        break;
      case "hearing":
        grouped.hearings.push(item);
        break;
    }
  }
  return grouped;
}

function payloadString(item: MatterItem, key: string): string {
  const value = item.payload[key];
  return typeof value === "string" ? value : "";
}

/**
 * The list row a lawyer sees.
 *
 * W14 (B-26): `today` decides what "next" means. Before this wave the earliest
 * OPEN deadline won even when it was 49 days overdue, so the deadline that was
 * actually next (6 days away) was invisible on the card. Now an overdue
 * deadline is counted (`overdueCount`) and listed by GET /v1/matters/deadlines,
 * while `nextDeadline` is the earliest one still ahead.
 */
export function deriveMatterSummary(
  matter: Matter,
  items: readonly MatterItem[],
  today: string = todayIso(),
): MatterSummary {
  const grouped = groupItems(items);
  let next: NextDeadline | null = null;
  let nextHearing: NextHearing | null = null;
  let overdueCount = 0;
  let lastActivityAt = matter.updatedAt;
  for (const item of items) {
    if (item.updatedAt > lastActivityAt) lastActivityAt = item.updatedAt;
    if (isOpenDeadline(item)) {
      const dueDate = payloadString(item, "dueDate");
      if (dueDate < today) {
        overdueCount += 1;
        continue;
      }
      if (next === null || dueDate < next.dueDate) {
        next = {
          itemId: item.itemId,
          title: payloadString(item, "title"),
          dueDate,
          daysLeft: daysBetweenIso(today, dueDate),
          overdue: false,
        };
      }
      continue;
    }
    if (isPlannedHearing(item)) {
      const date = payloadString(item, "date");
      if (date < today) continue;
      if (nextHearing === null || date < nextHearing.date) {
        const kind = payloadString(item, "kind");
        nextHearing = {
          itemId: item.itemId,
          title: payloadString(item, "title") || payloadString(item, "court"),
          date,
          time: payloadString(item, "time"),
          kind: (HEARING_KINDS as readonly string[]).includes(kind) ? (kind as HearingKind) : "durusma",
          daysLeft: daysBetweenIso(today, date),
        };
      }
    }
  }
  return {
    id: matter.id,
    title: matter.title,
    client: matter.client,
    opposing: matter.opposing,
    court: matter.court,
    docketNo: matter.docketNo,
    kind: matter.kind,
    status: matter.status,
    createdAt: matter.createdAt,
    updatedAt: matter.updatedAt,
    counts: {
      files: grouped.files.length,
      answers: grouped.answers.length,
      drafts: grouped.drafts.length,
      notes: grouped.notes.length,
      events: grouped.events.length,
      deadlines: grouped.deadlines.length,
      hearings: grouped.hearings.length,
    },
    nextDeadline: next,
    overdueCount,
    nextHearing,
    lastActivityAt,
  };
}

/** The activity row of one item (W14 B-43): what changed, in one line. */
export function describeItem(item: MatterItem): ActivityEntry {
  let title = "";
  switch (item.kind) {
    case "file":
      title = payloadString(item, "fileName");
      break;
    case "answer":
      title = payloadString(item, "question");
      break;
    case "draft":
      title = payloadString(item, "title");
      break;
    case "note":
      title = payloadString(item, "text");
      break;
    case "event":
      title = payloadString(item, "title");
      break;
    case "deadline":
      title = payloadString(item, "title");
      break;
    case "hearing":
      title = payloadString(item, "title") || payloadString(item, "court");
      break;
  }
  return {
    itemId: item.itemId,
    kind: item.kind,
    refId: item.refId,
    title: trimToWordBoundary(title, 160),
    at: item.updatedAt,
    kindLabel: MATTER_ITEM_KIND_LABELS[item.kind],
  };
}

/**
 * Cut a text at a WORD boundary, never mid-word (UXAUDIT P1-18: every one of
 * the seven analysis snippets was cut mid-word). Code points, not code units
 * (ADR-003): a surrogate pair is one character here.
 */
export function trimToWordBoundary(text: string, maxCodePoints: number): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const points = [...collapsed];
  if (points.length <= maxCodePoints) return collapsed;
  const window = points.slice(0, maxCodePoints).join("");
  const lastSpace = window.lastIndexOf(" ");
  // Keep at least half the window: a text with no space inside the window
  // (one long token) is cut where it is rather than emptied.
  const cut = lastSpace >= Math.floor(maxCodePoints / 2) ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s.,;:!?…]+$/u, "")}…`;
}

/** Case-insensitive "contains" over the searchable columns (both stores). */
export function matterMatchesQuery(matter: Matter, q: string): boolean {
  const needle = foldTurkishForFilter(q);
  return [matter.title, matter.client, matter.opposing, matter.court, matter.docketNo].some((v) =>
    foldTurkishForFilter(v).includes(needle),
  );
}
