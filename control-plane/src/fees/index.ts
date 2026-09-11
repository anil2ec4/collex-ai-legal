/**
 * Harç / parasal sınır / AAÜT hesaplayıcısı (W14 B-35).
 *
 * Pure TypeScript, no I/O, no clock — the same shape as `src/deadlines/`:
 * tariff data + a calculator + a mountable router + an immutable Turkish
 * disclaimer + a `verified` block on every tariff line.
 */

export {
  FEE_AMOUNT_UNKNOWN_TEXT,
  FEE_DISCLAIMER,
  FEE_GROUP_LABELS_TR,
  FEE_LINE_GROUPS,
  FEE_TARIFFS,
  FEE_YEARS,
  findTariff,
  findTariffLine,
  type FeeLineGroup,
  type FeeLineKind,
  type FeeReference,
  type FeeTariff,
  type FeeTariffLine,
  type FeeVerification,
  type FeeVerificationStatus,
} from "./tariffs.js";

export {
  computeFees,
  FEE_COMPUTE_KINDS,
  FEE_LIMIT_PATHS,
  FeeInputError,
  roundTl,
  type FeeComputation,
  type FeeComputeInput,
  type FeeComputeKind,
  type FeeComputeOptions,
  type FeeCourtKind,
  type FeeLimitPath,
  type FeeStep,
  type FeeStepStatus,
} from "./calc.js";

export {
  createFeesRouter,
  feeComputeRequestSchema,
  type FeeComputeRequest,
  type FeesRouterDeps,
} from "./routes.js";
