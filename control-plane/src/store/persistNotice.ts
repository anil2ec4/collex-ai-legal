/**
 * Persistence outcome, told to the caller (W12-FIX, 02.09.2026).
 *
 * Every durable write used to be fire-and-forget: the route answered 200 and
 * "kaydedildi" while DRAFT_PERSIST_FAILED / ANSWER_PERSIST_FAILED went to a
 * console window the lawyer never reads. The stores now expose
 * `persisted(id)` (the outcome of the last write, awaited) and the routes
 * carry it in the body: `persisted:false` plus ONE Turkish warning under the
 * machine code. The record is still served from the cache for the life of
 * the process — the warning says exactly that, and what to do.
 */

export const DRAFT_PERSIST_FAILED = "DRAFT_PERSIST_FAILED";
export const DRAFT_PERSIST_FAILED_MESSAGE_TR =
  "Taslak sürümü veritabanına yazılamadı; bu oturumda açık kalır ama yeniden başlatınca kaybolur. " +
  "Veritabanını (ColleX-Baslat.cmd) kontrol edip yeniden kaydedin veya DOCX olarak indirin.";

export const ANSWER_PERSIST_FAILED = "ANSWER_PERSIST_FAILED";
export const ANSWER_PERSIST_FAILED_MESSAGE_TR =
  "Cevap veritabanına yazılamadı; bu oturumda görünür ama yeniden başlatınca kaybolur. " +
  "Veritabanını (ColleX-Baslat.cmd) kontrol edin veya doğrulama dosyasını (JSON) indirin.";

/** `CODE:<Türkçe>` — the warning shape every route already uses. */
export function persistFailedWarning(code: string, message: string): string {
  return `${code}:${message}`;
}
