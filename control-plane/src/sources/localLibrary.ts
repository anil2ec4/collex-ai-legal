/**
 * Yerel kütüphane spool (W14/B-20).
 *
 * Today every document a live research run fetches is thrown away when the run
 * ends: `collex_local` holds 0 documents and 0 chunks, so "Yerel korpus" is
 * permanently ÇEKİMSER, the Turkish FTS index, the citator lane and the as-of
 * engine have nothing to work on, and asking the same question twice goes back
 * to the network twice. This module is the first half of the fix: every FULL
 * document a run (or a "Tam metni getir" card) pulls is written to a durable
 * spool with complete provenance, deduplicated by identity + content hash.
 *
 * WHY A SPOOL AND NOT A DIRECT INSERT. The corpus contract lives in Python:
 * `ingestion/identity.py` (logical identity), `ingestion/versioning.py`
 * (temporal close-on-append, ADR-012), `ingestion/chunking.py`
 * (non-overlapping chunks, ADR-013) and `ingestion/relations.py` (citator
 * edges). Re-implementing any of those in TypeScript would give the same
 * document two different identities depending on which runtime wrote it, which
 * is precisely the defect ADR-013 exists to prevent. The control-plane
 * therefore writes an ingestion-ready record and the existing Python pipeline
 * publishes it. The second half — a `SourcePort` over this directory — belongs
 * to the lane that owns `ingestion/**`; see the integration request in
 * W14-L-SOURCES.md. Until it lands, nothing is written to `collex_local` and
 * the manifest says so instead of pretending otherwise.
 *
 * Provenance rules (TRMARKET):
 *  - the label is **"resmî kaynak"** plus the fetch day, never "(SENTETİK)" —
 *    for a lawyer that word reads as "this system invents decisions";
 *  - `fetchedAt` is the real fetch timestamp, not the spool write time;
 *  - `contentSha256` is the hash of the CANONICAL text, so the spool record
 *    and any later citation of it agree byte for byte.
 */

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Envelope version; a reader must refuse an envelope it does not know. */
export const LIBRARY_RECORD_SCHEMA = "collex.library.document/v1";

/** Scope every spooled document is published under (never 'tenant'). */
export const LIBRARY_SCOPE = "public";

/** The provenance label a spooled document carries on every surface. */
export const LIBRARY_ORIGIN_LABEL = "resmî kaynak";

export interface LibraryDocument {
  schema: typeof LIBRARY_RECORD_SCHEMA;
  /** Provider family: BEDESTEN, EMSAL, AYM, MEVZUAT, UYUSMAZLIK, ... */
  source: string;
  /** The upstream's own id — the second half of the logical identity. */
  externalId: string;
  title: string;
  sourceUrl: string;
  /** Raw MCP tool that produced the text (audit trail). */
  toolName: string;
  /** ISO timestamp of the FETCH, not of the spool write. */
  fetchedAt: string;
  /** "resmî kaynak" — asserted by the writer, never taken from a caller. */
  originLabel: typeof LIBRARY_ORIGIN_LABEL;
  scope: typeof LIBRARY_SCOPE;
  mediaType: "text/markdown";
  /** Canonical text: CRLF folded to "\n", then NFC. */
  text: string;
  /** SHA-256 over the UTF-8 bytes of `text`. */
  contentSha256: string;
  /** Length in Unicode code points (a cheap cross-runtime consistency check). */
  contentCodePoints: number;
  /** Run that fetched it, when it came from a research run. */
  runId?: string;
}

export interface LibraryWriteInput {
  source: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  toolName: string;
  fetchedAt: string;
  /** MUST already be canonical (canonicalizeFetchedText). */
  text: string;
  contentSha256: string;
  runId?: string;
}

export interface LibraryWriteOutcome {
  /** "written" | "duplicate" | "failed" — never silently nothing. */
  action: "written" | "duplicate" | "failed";
  key: string;
  /** Absolute path of the spool file when written. */
  path?: string;
  /** Machine reason for a failure; the caller decides how loud to be. */
  reason?: string;
}

/**
 * Spool key: provider + external id + content hash. The same document fetched
 * twice with the same text is ONE record ("duplicate"); the same document with
 * changed text is a new record, which is what lets the Python pipeline append
 * a new VERSION rather than overwrite one.
 */
export function libraryKey(source: string, externalId: string, sha256: string): string {
  const safe = (value: string): string =>
    value.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 80) || "_";
  return `${safe(source)}__${safe(externalId)}__${sha256.slice(0, 16)}`;
}

export interface LocalLibraryPort {
  /** Persist one fetched document; never throws. */
  put(input: LibraryWriteInput): Promise<LibraryWriteOutcome>;
  /** Keys currently held (for the manifest and the tests). */
  keys(): Promise<string[]>;
}

/**
 * A port that keeps nothing. This is the DEFAULT, so a deployment that has not
 * enabled the local library behaves exactly as it does today — and says
 * "kapalı" on the coverage page rather than implying a growing library.
 */
export class DisabledLocalLibrary implements LocalLibraryPort {
  async put(input: LibraryWriteInput): Promise<LibraryWriteOutcome> {
    return {
      action: "failed",
      key: libraryKey(input.source, input.externalId, input.contentSha256),
      reason: "LIBRARY_DISABLED",
    };
  }

  async keys(): Promise<string[]> {
    return [];
  }
}

/** In-memory port for tests and for a run that must not touch the disk. */
export class InMemoryLocalLibrary implements LocalLibraryPort {
  readonly records = new Map<string, LibraryDocument>();

  async put(input: LibraryWriteInput): Promise<LibraryWriteOutcome> {
    const key = libraryKey(input.source, input.externalId, input.contentSha256);
    if (this.records.has(key)) return { action: "duplicate", key };
    this.records.set(key, buildRecord(input));
    return { action: "written", key };
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }
}

/**
 * File-backed spool: one JSON file per (document, content hash) under
 * `<dir>/<key>.json`, written to a temporary name and renamed into place so a
 * reader never sees a half-written record.
 */
export class FileLocalLibrary implements LocalLibraryPort {
  constructor(private readonly directory: string) {}

  async put(input: LibraryWriteInput): Promise<LibraryWriteOutcome> {
    const key = libraryKey(input.source, input.externalId, input.contentSha256);
    const path = join(this.directory, `${key}.json`);
    try {
      await mkdir(this.directory, { recursive: true });
      try {
        await readFile(path, "utf8");
        return { action: "duplicate", key, path };
      } catch {
        // Not present yet: fall through and write it.
      }
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(buildRecord(input), null, 2)}\n`, "utf8");
      await rename(temporary, path);
      return { action: "written", key, path };
    } catch (error) {
      // Persistence NEVER fails the research run that produced the document:
      // the answer is already correct, the library is an accumulation.
      const name = error instanceof Error ? error.name : typeof error;
      return { action: "failed", key, reason: `LIBRARY_WRITE_FAILED:${name}` };
    }
  }

  async keys(): Promise<string[]> {
    try {
      const entries = await readdir(this.directory);
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .sort();
    } catch {
      return [];
    }
  }
}

function buildRecord(input: LibraryWriteInput): LibraryDocument {
  return {
    schema: LIBRARY_RECORD_SCHEMA,
    source: input.source,
    externalId: input.externalId,
    title: input.title,
    sourceUrl: input.sourceUrl,
    toolName: input.toolName,
    fetchedAt: input.fetchedAt,
    originLabel: LIBRARY_ORIGIN_LABEL,
    scope: LIBRARY_SCOPE,
    mediaType: "text/markdown",
    text: input.text,
    contentSha256: input.contentSha256,
    contentCodePoints: [...input.text].length,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
  };
}

/**
 * Parse a spool file. Refuses an unknown envelope and a record whose declared
 * code-point length disagrees with its text — the cheapest possible guard
 * against a file that was edited by hand between the two runtimes.
 */
export function parseLibraryRecord(raw: string): LibraryDocument | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Partial<LibraryDocument>;
  if (record.schema !== LIBRARY_RECORD_SCHEMA) return undefined;
  if (typeof record.text !== "string" || typeof record.contentSha256 !== "string") {
    return undefined;
  }
  if (record.contentCodePoints !== [...record.text].length) return undefined;
  if (record.originLabel !== LIBRARY_ORIGIN_LABEL) return undefined;
  return record as LibraryDocument;
}
