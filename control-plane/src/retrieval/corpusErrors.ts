/**
 * Typed classification of local-corpus (PostgreSQL) failures (W12 lane B,
 * contract [R] item 4).
 *
 * Before this module, a stopped database reached the lawyer as
 * `RETRIEVAL_ERROR:primary:all retrieval lanes failed: lane exact failed:
 * connect ECONNREFUSED 127.0.0.1:55432; lane lexical failed: ...` — driver
 * prose in a user-facing warning. The pipeline still degraded honestly (a
 * PARTIAL answer, never a fabricated one), but the reader was handed a stack
 * of socket errors instead of the one fact that matters: the corpus could not
 * be reached at all.
 *
 * `isCorpusUnavailable` recognises the connection-class failures postgres.js
 * and the server produce — refused/reset/timed-out sockets, the driver's own
 * CONNECT_TIMEOUT / CONNECTION_* codes, and the SQLSTATE classes that mean
 * "there is no usable database on the other end" (08xxx connection
 * exceptions, 3D000 invalid catalog name, 57P0x shutdown/cannot-connect,
 * 28xxx authentication). Everything else (a missing relation, an unknown text
 * search config, a statement timeout) stays a contained lane failure with
 * its diagnostic message, because that message is about OUR query and an
 * operator needs it.
 *
 * Measured shapes on this machine (postgres.js 3.4.9, PostgreSQL 18.1):
 *   missing database  -> PostgresError code "3D000"
 *   refused port      -> Error code "ECONNREFUSED", errno -4078
 *   ended pool        -> Error code "CONNECTION_ENDED"
 */

export const CORPUS_UNAVAILABLE = "CORPUS_UNAVAILABLE" as const;

/**
 * The only text a user-facing surface may show for a connection-class failure.
 *
 * W15: the old sentence ("Yerel korpusa ulaşılamadı; veritabanı çalışmıyor
 * olabilir.") named two things a lawyer has never heard of — "korpus" and
 * "veritabanı" — and told him nothing to do about either. The canonical
 * glossary calls the thing "hukuk kütüphanesi", and an error sentence in this
 * product states what happened AND the next step, in that order.
 */
export const CORPUS_UNAVAILABLE_MESSAGE_TR =
  "Bu bilgisayardaki hukuk kütüphanesi açılamadı, bu yüzden arama yapılamadı." +
  " ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın;" +
  " kütüphane açılınca arama yeniden çalışır.";

const CONNECTION_CODES: ReadonlySet<string> = new Set([
  // node:net / OS
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  // postgres.js driver
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  // SQLSTATE
  "3D000", // invalid_catalog_name — the database does not exist
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now — server starting up / shutting down
]);

const CONNECTION_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH)\b/,
  /\b(CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED)\b/,
  /database ".*" does not exist/i,
  /the database system is (starting|shutting) (up|down)/i,
  /connection refused/i,
  /connect timeout/i,
  /timeout expired/i,
];

/** The `.code` of an error object when it carries a string one. */
export function corpusErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

/** True when a lane failure's code/message mean the corpus could not be reached. */
export function isCorpusUnavailableCode(code: string | undefined, message?: string): boolean {
  if (code !== undefined) {
    if (CONNECTION_CODES.has(code)) return true;
    // SQLSTATE classes: 08 = connection exception, 28 = invalid authorization.
    if (/^(08|28)[0-9A-Z]{3}$/.test(code)) return true;
  }
  if (message !== undefined) {
    return CONNECTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
  }
  return false;
}

/** Classify a thrown error object. */
export function isCorpusUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : undefined;
  return isCorpusUnavailableCode(corpusErrorCode(error), message);
}
