/**
 * Süre hesabı (procedural deadlines) module — public surface.
 *
 *   createDeadlinesRouter()  hono sub-router: GET /v1/deadlines/rules,
 *                            GET /v1/deadlines/holidays, POST /v1/deadlines/compute
 *   computeDeadline()        pure calculator (no DB, no clock)
 *   DEADLINE_RULES           source-cited rule registry (all 'dogrulanmadi' until
 *                            re-verified against the article text)
 *   DEADLINE_DISCLAIMER      the mandatory verbatim disclaimer
 */

export {
  computeDeadline,
  DeadlineInputError,
  CUSTOM_PERIOD_MAX,
  type ComputeDeadlineInput,
  type ComputeDeadlineOptions,
  type DeadlineComputation,
  type DeadlineErrorKind,
  type AdliTatilOutcome,
} from "./calc.js";
export {
  DEADLINE_DISCLAIMER,
  DEADLINE_PROCEDURES,
  DEADLINE_RULES,
  DEADLINE_UNITS,
  UNIT_LABELS_TR,
  findDeadlineRule,
  type DeadlinePeriod,
  type DeadlineProcedure,
  type DeadlineReference,
  type DeadlineRule,
  type DeadlineStartKind,
  type DeadlineTransition,
  type DeadlineUnit,
  type DeadlineVerification,
} from "./rules.js";
export {
  ADLI_TATIL_LABEL,
  RELIGIOUS_CALENDAR_YEARS,
  adliTatilRange,
  firstWorkingDayOnOrAfter,
  halfDayInfo,
  holidaysForYear,
  isAdliTatil,
  isHoliday,
  isWorkingDay,
  nextWorkingDay,
  periodTouchesAdliTatil,
  religiousCalendarCovers,
  type HolidayInfo,
  type HolidayKind,
} from "./holidays.js";
export {
  WEEKDAY_NAMES_TR,
  MONTH_NAMES_TR,
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysBetween,
  daysInMonth,
  formatTrLong,
  isWeekend,
  parseIsoDate,
  toIsoDate,
  toTrDate,
  weekdayIndex,
  weekdayName,
  type CivilDate,
  type WeekdayNameTr,
} from "./dates.js";
export { createDeadlinesRouter, computeRequestSchema, type ComputeRequest, type DeadlinesRouterDeps } from "./routes.js";
export {
  readServiceNotice,
  textFromChunks,
  NOTICE_READER_VERSION,
  E_TEBLIGAT_DEEMED_DAYS,
  MAX_NOTICE_TEXT_CODE_POINTS,
  type NoticeReading,
  type DateCandidate,
  type DeadlineProposal,
  type NoticeMatterItem,
} from "./serviceNotice.js";
export { createNoticeDeadlineRouter, noticeRequestSchema, type NoticeRouterDeps, type NoticeFilePort } from "./noticeRoutes.js";
