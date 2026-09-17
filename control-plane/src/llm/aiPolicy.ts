/**
 * ONE application-level AI policy (W21): which model may write a draft, and
 * where a file may travel to be read by one.
 *
 * The problem
 * -----------
 * Until W20 the choice of model was made in five places that did not talk to
 * each other: the startup environment, two per-request browser flags, one
 * block inside the answer pipeline, a two-valued data boundary, and each lane
 * (cloud paragraph tools, matter analysis) on its own. A lawyer could not
 * say "use my own model and nothing else" once and have every lane obey it,
 * and an operator who pointed the "local" model at a hosted address filled
 * the matter-analysis roles with someone else's computer.
 *
 * The four policies, in plain words
 * ---------------------------------
 *   LOCAL_ONLY          Only a model on this computer or on the lawyer's own
 *                       network may be used. Nothing is ever sent to an
 *                       outside service, not even when a request asks for
 *                       it. No local model -> rule-based answer, and the
 *                       answer SAYS so (warning MODEL_UNAVAILABLE).
 *   LOCAL_PREFERRED     The default (`AUTO` is accepted as another name for
 *                       it). A configured local model is used without any
 *                       browser flag; with none, answers are rule-based. An
 *                       outside service is used only when THIS request gives
 *                       explicit consent (`useCloudAi`) and the data
 *                       boundary allows it.
 *   CLOUD_ALLOWED       Same consent rule as above: the outside service runs
 *                       only for a request that consents. The difference is
 *                       that a "local" model address which is really an
 *                       outside service is not refused at startup; it is
 *                       then treated like the cloud lane (consent per
 *                       request) and is NEVER used for matter analysis,
 *                       which has no per-request consent.
 *   DETERMINISTIC_ONLY  No model at all. Answers are rule-based (warning
 *                       AI_POLICY_DETERMINISTIC) and matter-analysis tasks
 *                       that need a model are refused.
 *
 * How it combines with the data boundary
 * --------------------------------------
 * `COLLEX_DATA_BOUNDARY` (endpointTrust.ts) still exists and is still
 * obeyed. The STRICTER of the two wins: boundary LOCAL_ONLY with policy
 * CLOUD_ALLOWED is effectively LOCAL_ONLY, and policy LOCAL_ONLY or
 * DETERMINISTIC_ONLY forces the LOCAL_ONLY boundary on every consumer of
 * the boundary (the adapter's per-call check, the /v1/ai/* gate, the
 * embedding gate). Loosening is impossible: no policy turns LOCAL_ONLY into
 * ALLOW_CLOUD.
 *
 * An unrecognized `COLLEX_AI_POLICY` value is read as LOCAL_ONLY, not as the
 * default: a typo must never widen where a client file may go. Health says
 * the value was not recognized. W21 R2-30: an unrecognized
 * `COLLEX_DATA_BOUNDARY` value is treated the same way (LOCAL_ONLY plus a
 * health warning; see parseDataBoundary).
 *
 * One decision function per question
 * ----------------------------------
 *   decideProvider      who drafts an answer (local | cloud | rule-based)
 *                       and which warnings the answer must carry;
 *   decideModelTasks /  whether matter analysis may run model tasks: only
 *   policyAllowsModelTasks  on-machine or own-network routes count, under
 *                       every policy, because that lane has no per-request
 *                       consent.
 * A failed local drafter falls back to the rule-based one (the pipeline's
 * LOCAL_DRAFTER_FALLBACK), never to the cloud: no function here ever turns
 * "local failed" into "try the cloud".
 *
 * Concurrency (8 GB appliance)
 * ----------------------------
 * The local model is protected by ONE RequestGate per resolved route table
 * (providerFactory.resolveModelRoutes), sized by COLLEX_LOCAL_LLM_CONCURRENCY
 * (default 1). Every role of that table — answer drafting, the judge, matter
 * extraction and synthesis — queues behind the same gate. The gate is
 * in-process: a SEPARATE worker process (scripts/analysis_worker.mjs) builds
 * its own table and so its own gate, and the two would together exceed the
 * limit. The Mac production profile should therefore run the analysis
 * worker in-process (serve.mjs does). There is deliberately no cross-process
 * lock.
 */

import { trustLabelTr, type DataBoundary, type EndpointTrust } from "./endpointTrust.js";
import { DATA_BOUNDARY_ENV, parseDataBoundary } from "./localGenerationConfig.js";

type EnvLike = Readonly<Record<string, string | undefined>>;

export const AI_POLICIES = [
  "LOCAL_ONLY",
  "LOCAL_PREFERRED",
  "CLOUD_ALLOWED",
  "DETERMINISTIC_ONLY",
] as const;
export type AiPolicy = (typeof AI_POLICIES)[number];

/** Name of the policy setting. `AUTO` is read as LOCAL_PREFERRED. */
export const AI_POLICY_ENV = "COLLEX_AI_POLICY" as const;

export const DEFAULT_AI_POLICY: AiPolicy = "LOCAL_PREFERRED";

/** Higher is stricter. */
const STRICTNESS: Readonly<Record<AiPolicy, number>> = Object.freeze({
  CLOUD_ALLOWED: 0,
  LOCAL_PREFERRED: 1,
  LOCAL_ONLY: 2,
  DETERMINISTIC_ONLY: 3,
});

// ---------------------------------------------------------------------------
// Warning codes and their lawyer-facing sentences (the ONE source of these
// texts; answerPipeline.ts re-exports the three W20 ones unchanged).
// ---------------------------------------------------------------------------

export const MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE";
export const AI_POLICY_DETERMINISTIC = "AI_POLICY_DETERMINISTIC";
export const LOCAL_AI_UNAVAILABLE = "LOCAL_AI_UNAVAILABLE";
export const CLOUD_AI_REFUSED_LOCAL_ONLY = "CLOUD_AI_REFUSED_LOCAL_ONLY";
export const AI_UNAVAILABLE = "AI_UNAVAILABLE";

/** Warning text when a request asks for cloud AI on a server that has none configured. */
export const AI_UNAVAILABLE_MESSAGE_TR =
  "Bulut yapay zekâ bu sunucuda yapılandırılmamış; kural tabanlı üretimle devam edildi.";

/** W21: the same situation, when the configured local model wrote the answer instead. */
export const AI_UNAVAILABLE_LOCAL_USED_MESSAGE_TR =
  "Bulut yapay zekâ bu sunucuda yapılandırılmamış; yanıt ayarlı yerel modelle hazırlandı.";

/** W20: `useLocalAi` asked for, but no local model is configured. */
export const LOCAL_AI_UNAVAILABLE_MESSAGE_TR =
  "Yerel dil modeli yapılandırılmadığı için yanıt kural tabanlı yöntemle hazırlandı.";

/** W21: `useLocalAi` asked for, but the configured model is an outside service. */
export const LOCAL_AI_OFF_MACHINE_MESSAGE_TR =
  "Ayarlı model bu bilgisayarda ya da kendi ağınızda değil; onayınız olmadan kullanılmadı," +
  " yanıt kural tabanlı yöntemle hazırlandı.";

/**
 * W21: `useLocalAi` asked for, the configured model is an outside service and
 * the route table REFUSED it (policy LOCAL_PREFERRED / LOCAL_ONLY, or the
 * LOCAL_ONLY data boundary). Consent would not change that, so the consent
 * sentence above would be false here; "not configured" would be false too.
 */
export const LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR =
  "Ayarlı model bu bilgisayarda ya da kendi ağınızda değil; yapay zekâ ilkesi dışarıdaki" +
  " servislere izin vermediği için kullanılmadı, yanıt kural tabanlı yöntemle hazırlandı.";

/** W21: `useLocalAi` asked for, but the configured model address failed the trust rules. */
export const LOCAL_AI_REFUSED_MESSAGE_TR =
  "Ayarlı model adresi güven kurallarını geçmediği için kullanılmadı; yanıt kural tabanlı" +
  " yöntemle hazırlandı.";

/** W20: `useCloudAi` asked for under the LOCAL_ONLY data boundary. */
export const CLOUD_AI_REFUSED_LOCAL_ONLY_MESSAGE_TR =
  "Veri sınırı yalnız yerel olduğu için bulut yapay zekâ kullanılmadı;" +
  " dosya bu bilgisayardan dışarı gönderilmedi.";

/** W21: LOCAL_ONLY with no usable local model. */
/**
 * Cloud AI was asked for but is not configured, and the answer was written
 * by the endpoint behind the LOCAL setting — which is NOT on this computer or
 * the lawyer's network. Saying "the local model wrote it" would be false.
 */
export const AI_UNAVAILABLE_OFF_MACHINE_USED_MESSAGE_TR =
  "Bulut yapay zekâ bu sunucuda ayarlı değil; cevabı, yerel model ayarına girilmiş ve bu" +
  " bilgisayarda ya da kendi ağınızda OLMAYAN dış bir sunucu yazdı.";

export const MODEL_UNAVAILABLE_MESSAGE_TR =
  "Yapay zekâ yalnız yerel modelle çalışacak biçimde ayarlı, ancak yerel model hazır değil;" +
  " yanıt kural tabanlı yöntemle hazırlandı ve dosya dışarı gönderilmedi.";

/** W21: LOCAL_ONLY, and the configured model is an outside service (refused). */
export const MODEL_UNAVAILABLE_OFF_MACHINE_MESSAGE_TR =
  "Yapay zekâ yalnız yerel modelle çalışacak biçimde ayarlı; ayarlı model bu bilgisayarda ya da" +
  " kendi ağınızda olmadığı için kullanılmadı. Yanıt kural tabanlı yöntemle hazırlandı ve dosya" +
  " dışarı gönderilmedi.";

/** W21: DETERMINISTIC_ONLY. */
export const AI_POLICY_DETERMINISTIC_MESSAGE_TR =
  "Yapay zekâ kullanımı kapalı; yanıt yalnız kural tabanlı yöntemle hazırlandı.";

const UNRECOGNIZED_POLICY_TR =
  "Yapay zekâ ilkesi ayarı tanınmadı; güvenli tarafta kalmak için yalnız yerel çalışma seçildi.";

/** W21 R2-30: COLLEX_DATA_BOUNDARY held a value that is not a boundary. */
export const UNRECOGNIZED_BOUNDARY_TR =
  "Veri sınırı ayarı tanınmadı; güvenli tarafta kalmak için yalnız yerel çalışma seçildi.";

const NARROWED_BY_BOUNDARY_TR =
  "Veri sınırı yalnız yerel olarak ayarlandığı için yapay zekâ ilkesi de yalnız yerel çalışmaya daraltıldı.";

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ParsedAiPolicy {
  readonly policy: AiPolicy;
  /** False for a value that is not one of the four (or AUTO). */
  readonly recognized: boolean;
  /** False when the setting is absent or blank (the default applies). */
  readonly given: boolean;
}

/** Read one raw setting value. Case and `-`/space vs `_` are forgiven. */
export function parseAiPolicy(raw: string | undefined): ParsedAiPolicy {
  const value = (raw ?? "").trim().toUpperCase().replace(/[\s-]+/gu, "_");
  if (value === "") return { policy: DEFAULT_AI_POLICY, recognized: true, given: false };
  if (value === "AUTO") return { policy: "LOCAL_PREFERRED", recognized: true, given: true };
  if ((AI_POLICIES as readonly string[]).includes(value)) {
    return { policy: value as AiPolicy, recognized: true, given: true };
  }
  // Fail closed: a typo must not widen where a client file may go.
  return { policy: "LOCAL_ONLY", recognized: false, given: true };
}

/** The CONFIGURED policy (before the data boundary narrows it). */
export function resolveAiPolicy(env: EnvLike = process.env): AiPolicy {
  return parseAiPolicy(env[AI_POLICY_ENV]).policy;
}

/** The stricter of two policies. */
export function stricterPolicy(a: AiPolicy, b: AiPolicy): AiPolicy {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

/** The policy every AI entry point obeys, with the boundary it implies. */
export interface EffectiveAiPolicy {
  /** Effective policy: the stricter of the configured one and the boundary. */
  readonly policy: AiPolicy;
  readonly configuredPolicy: AiPolicy;
  /** Effective data boundary handed to every boundary consumer. */
  readonly boundary: DataBoundary;
  readonly configuredBoundary: DataBoundary;
  /** Plain Turkish summary of what the policy lets the product do. */
  readonly reasonTr: string;
  /** Plain Turkish notes (an unrecognized setting, a narrowed policy). */
  readonly warnings: readonly string[];
}

const POLICY_REASON_TR: Readonly<Record<AiPolicy, string>> = Object.freeze({
  LOCAL_ONLY:
    "Yapay zekâ yalnız bu bilgisayardaki ya da kendi ağınızdaki modelle çalışır;" +
    " dosyalar dışarıdaki bir servise gönderilmez.",
  LOCAL_PREFERRED:
    "Ayarlı bir yerel model varsa o kullanılır, yoksa yanıtlar kural tabanlı hazırlanır." +
    " Bulut yapay zekâ yalnız o istek için açıkça onay verdiğinizde kullanılır.",
  CLOUD_ALLOWED:
    "Bulut yapay zekâ, istek başına onay verdiğinizde kullanılabilir; onay yoksa yerel model," +
    " o da yoksa kural tabanlı yöntem kullanılır. Dosya incelemesi yalnız yerel modelle yapılır.",
  DETERMINISTIC_ONLY:
    "Yapay zekâ kapalı: yanıtlar yalnız kural tabanlı yöntemle hazırlanır ve dosya" +
    " incelemesinde model gerektiren işler yapılmaz.",
});

/**
 * Combine a configured policy with the configured data boundary. The
 * stricter wins; LOCAL_ONLY and DETERMINISTIC_ONLY force the LOCAL_ONLY
 * boundary.
 */
export function combineAiPolicy(
  configuredPolicy: AiPolicy,
  configuredBoundary: DataBoundary,
  notes: readonly string[] = [],
): EffectiveAiPolicy {
  const boundaryAsPolicy: AiPolicy = configuredBoundary === "LOCAL_ONLY" ? "LOCAL_ONLY" : "CLOUD_ALLOWED";
  const policy = stricterPolicy(configuredPolicy, boundaryAsPolicy);
  const boundary: DataBoundary =
    policy === "LOCAL_ONLY" || policy === "DETERMINISTIC_ONLY" ? "LOCAL_ONLY" : configuredBoundary;
  const warnings = [...notes];
  if (policy !== configuredPolicy) warnings.push(NARROWED_BY_BOUNDARY_TR);
  return {
    policy,
    configuredPolicy,
    boundary,
    configuredBoundary,
    reasonTr: POLICY_REASON_TR[policy],
    warnings,
  };
}

/**
 * Resolve the effective policy from the environment. Call it ONCE at startup
 * (serve.mjs) and hand the result to every consumer; in-process callers that
 * were not given one (tests, createApp without serve.mjs) resolve it per
 * call, the way resolveDataBoundary always has been.
 */
export function resolveEffectiveAiPolicy(env: EnvLike = process.env): EffectiveAiPolicy {
  const parsed = parseAiPolicy(env[AI_POLICY_ENV]);
  // R2-30: the boundary is read the way the policy is: forgiving spelling,
  // failing closed on an unrecognized value, and saying so on health.
  const boundary = parseDataBoundary(env[DATA_BOUNDARY_ENV]);
  const notes: string[] = [];
  if (!parsed.recognized) notes.push(UNRECOGNIZED_POLICY_TR);
  if (!boundary.recognized) notes.push(UNRECOGNIZED_BOUNDARY_TR);
  return combineAiPolicy(parsed.policy, boundary.boundary, notes);
}

/** On this computer or on the lawyer's own (explicitly trusted) network. */
export function isOnPremisesTrust(trust: EndpointTrust | null | undefined): boolean {
  return trust === "LOCAL_PROCESS" || trust === "TRUSTED_LOCAL_NETWORK";
}

// ---------------------------------------------------------------------------
// The answer decision
// ---------------------------------------------------------------------------

export type DrafterChoice = "local" | "cloud" | "rule-based";

export interface AiPolicyWarning {
  readonly code: string;
  readonly messageTr: string;
}

export interface ProviderDecisionInput {
  /** The EFFECTIVE policy (combineAiPolicy). */
  readonly policy: AiPolicy;
  /** The EFFECTIVE data boundary. */
  readonly boundary: DataBoundary;
  /** A local model is wired (the route table's answer + verifier roles). */
  readonly localConfigured: boolean;
  /**
   * Where that local model lives. CLOUD means "an outside service behind a
   * local-looking setting": it then needs the same per-request consent as
   * the cloud lane. Unknown (undefined) is read as on this computer only
   * because every production local port comes from the route table, which
   * always records its trust.
   */
  readonly localTrust?: EndpointTrust | null;
  /**
   * W21: the route table REFUSED a configured endpoint, so no local port
   * exists. `trust` is the endpoint's trust when it could be classified
   * (CLOUD = an outside service the policy or the data boundary refused),
   * null when the address itself failed the trust rules (an unlisted LAN
   * host, a bad scheme). Absent or null = nothing was configured.
   */
  readonly localRefusal?: { readonly trust: EndpointTrust | null } | null;
  /** Cloud ports are wired (ANTHROPIC_API_KEY set). */
  readonly cloudConfigured: boolean;
  /** THIS request consents to an outside service (`useCloudAi: true`). */
  readonly requestConsentsCloud: boolean;
  /** THIS request explicitly asks for the local model (`useLocalAi: true`). */
  readonly requestAsksLocal: boolean;
}

export interface ProviderDecision {
  /** Who drafts (and, for a model, whose judge verifies). */
  readonly drafter: DrafterChoice;
  /** Warnings the answer must carry, in order. */
  readonly warnings: readonly AiPolicyWarning[];
  /** Plain Turkish: why this drafter. */
  readonly reasonTr: string;
}

const REASON_LOCAL_TR = "Yanıt ayarlı yerel modelle hazırlandı; dosya dışarıdaki bir servise gönderilmedi.";
const REASON_LOCAL_OFF_MACHINE_TR =
  "Yanıt, bu istek için verdiğiniz onayla dışarıdaki bir serviste çalışan modelle hazırlandı.";
const REASON_CLOUD_TR = "Yanıt, bu istek için verdiğiniz onayla bulut yapay zekâ ile hazırlandı.";
const REASON_RULE_BASED_TR = "Yanıt kural tabanlı yöntemle hazırlandı.";

/**
 * W21: why a `useLocalAi` request got no local model, in one sentence that
 * matches what health and the matter capabilities say about the same setup:
 *   wired, outside, no consent           -> "onayınız olmadan kullanılmadı";
 *   refused, outside (policy/boundary)   -> "ilke dışarıdaki servislere izin vermiyor";
 *   refused, address failed trust rules  -> "güven kurallarını geçmedi";
 *   nothing configured                   -> "yapılandırılmadığı için".
 * Used by decideProvider and by the pipeline's W20 flag path.
 */
export function localUnavailableMessageTr(input: {
  readonly localConfigured: boolean;
  readonly localTrust?: EndpointTrust | null | undefined;
  readonly localRefusal?: { readonly trust: EndpointTrust | null } | null | undefined;
}): string {
  if (input.localConfigured) {
    // Wired but not usable for this request: only an outside endpoint
    // without this request's consent gets here.
    return input.localTrust === "CLOUD" ? LOCAL_AI_OFF_MACHINE_MESSAGE_TR : LOCAL_AI_UNAVAILABLE_MESSAGE_TR;
  }
  const refusal = input.localRefusal;
  if (refusal === undefined || refusal === null) return LOCAL_AI_UNAVAILABLE_MESSAGE_TR;
  return refusal.trust === "CLOUD" ? LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR : LOCAL_AI_REFUSED_MESSAGE_TR;
}

/** W21: the MODEL_UNAVAILABLE sentence (LOCAL_ONLY), naming an outside model when that is the cause. */
function modelUnavailableMessageTr(input: ProviderDecisionInput): string {
  return !input.localConfigured && input.localRefusal?.trust === "CLOUD"
    ? MODEL_UNAVAILABLE_OFF_MACHINE_MESSAGE_TR
    : MODEL_UNAVAILABLE_MESSAGE_TR;
}

/**
 * THE decision for one answer. Pure: no port is touched here, so a refusal
 * is decided before any byte could leave.
 *
 * Order:
 *   1. DETERMINISTIC_ONLY -> rule-based, always, with its warning.
 *   2. An explicit `useLocalAi` asks for the local model and never gets the
 *      cloud (the W20 precedence), whatever else the request says.
 *   3. `useCloudAi` is honoured only where the policy and boundary permit
 *      an outside service and one is configured; a refusal or an absent
 *      cloud is said, and the policy's default path continues.
 *   4. Default path: the local model when one is usable, else rule-based
 *      (with MODEL_UNAVAILABLE under LOCAL_ONLY, where a model was promised).
 */
export function decideProvider(input: ProviderDecisionInput): ProviderDecision {
  if (input.policy === "DETERMINISTIC_ONLY") {
    return {
      drafter: "rule-based",
      warnings: [{ code: AI_POLICY_DETERMINISTIC, messageTr: AI_POLICY_DETERMINISTIC_MESSAGE_TR }],
      reasonTr: AI_POLICY_DETERMINISTIC_MESSAGE_TR,
    };
  }
  const cloudPermitted = input.policy !== "LOCAL_ONLY" && input.boundary === "ALLOW_CLOUD";
  const offMachine = input.localTrust === "CLOUD";
  // An outside service behind the local setting is used only as the cloud
  // lane would be: with this request's consent, where the policy permits it.
  const localUsable =
    input.localConfigured &&
    (!offMachine || (input.requestConsentsCloud && cloudPermitted && input.policy === "CLOUD_ALLOWED"));
  const local = (warnings: AiPolicyWarning[]): ProviderDecision => ({
    drafter: "local",
    warnings,
    reasonTr: offMachine ? REASON_LOCAL_OFF_MACHINE_TR : REASON_LOCAL_TR,
  });

  if (input.requestAsksLocal) {
    if (localUsable) return local([]);
    const askedWarnings: AiPolicyWarning[] = [
      {
        code: LOCAL_AI_UNAVAILABLE,
        // W21: an endpoint the route table refused is named as such; before
        // this, a refused hosted address read "no local model is configured"
        // while health said MODEL_OFF_MACHINE for the same setup.
        messageTr: localUnavailableMessageTr(input),
      },
    ];
    // The same situation gets the same code whether or not the browser sent
    // the legacy flag: LOCAL_ONLY promised a model and none answered.
    if (input.policy === "LOCAL_ONLY") {
      askedWarnings.push({ code: MODEL_UNAVAILABLE, messageTr: modelUnavailableMessageTr(input) });
    }
    return { drafter: "rule-based", warnings: askedWarnings, reasonTr: REASON_RULE_BASED_TR };
  }

  const warnings: AiPolicyWarning[] = [];
  let cloudMissing = false;
  if (input.requestConsentsCloud) {
    if (!cloudPermitted) {
      // Refused before any cloud port is touched: zero cloud calls.
      warnings.push({ code: CLOUD_AI_REFUSED_LOCAL_ONLY, messageTr: CLOUD_AI_REFUSED_LOCAL_ONLY_MESSAGE_TR });
    } else if (input.cloudConfigured) {
      return { drafter: "cloud", warnings, reasonTr: REASON_CLOUD_TR };
    } else {
      cloudMissing = true;
    }
  }

  if (localUsable) {
    if (cloudMissing) {
      warnings.push({
        code: AI_UNAVAILABLE,
        messageTr: offMachine ? AI_UNAVAILABLE_OFF_MACHINE_USED_MESSAGE_TR : AI_UNAVAILABLE_LOCAL_USED_MESSAGE_TR,
      });
    }
    return local(warnings);
  }
  if (cloudMissing) warnings.push({ code: AI_UNAVAILABLE, messageTr: AI_UNAVAILABLE_MESSAGE_TR });
  if (input.policy === "LOCAL_ONLY") {
    warnings.push({ code: MODEL_UNAVAILABLE, messageTr: modelUnavailableMessageTr(input) });
  }
  return { drafter: "rule-based", warnings, reasonTr: REASON_RULE_BASED_TR };
}

// ---------------------------------------------------------------------------
// Matter analysis (exhaustive review) — no per-request consent exists there
// ---------------------------------------------------------------------------

/** Anything that knows where it runs (exhaustive JsonGenerator, the local adapter). */
export interface TrustTagged {
  readonly trust: EndpointTrust;
}

/** Structural twin of exhaustive/worker.ts WorkerModelRoutes. */
export interface ModelTaskRoutes {
  readonly extraction?: TrustTagged | undefined;
  readonly synthesis?: TrustTagged | undefined;
}

export type ModelTaskCode = "OK" | "AI_POLICY_DETERMINISTIC" | "MODEL_UNAVAILABLE" | "MODEL_OFF_MACHINE";

export interface ModelTaskDecision {
  readonly allowed: boolean;
  readonly code: ModelTaskCode;
  /** Plain Turkish, safe to show. */
  readonly reasonTr: string;
}

/**
 * May matter analysis run the tasks that need a model?
 *
 *   DETERMINISTIC_ONLY          never;
 *   every other policy          only when BOTH roles exist and BOTH run on
 *                               this computer or the lawyer's own network.
 * CLOUD_ALLOWED does not change the second rule: an analysis run reads every
 * document of a matter and has no per-request consent, so an outside service
 * is refused there under every policy. The deterministic tasks
 * (contradictions, chronology) are unaffected by this decision.
 */
export function decideModelTasks(
  policy: AiPolicy,
  routes: ModelTaskRoutes,
  /** Where the configured local endpoint runs, when one is configured at all. */
  localTrust?: EndpointTrust | null,
  /**
   * W21: the route table's reason when it REFUSED a configured address that
   * could not be classified at all (an unlisted LAN host, a bad scheme). A
   * set-but-refused address is then never reported as "no model".
   */
  localRefusedReasonTr?: string | null,
): ModelTaskDecision {
  if (policy === "DETERMINISTIC_ONLY") {
    return {
      allowed: false,
      code: "AI_POLICY_DETERMINISTIC",
      reasonTr: "Yapay zekâ kullanımı kapalı olduğu için model gerektiren inceleme yapılmaz.",
    };
  }
  const offMachine: ModelTaskDecision = {
    allowed: false,
    code: "MODEL_OFF_MACHINE",
    reasonTr:
      "Ayarlı model bu bilgisayarda ya da kendi ağınızda değil; dosya incelemesi" +
      " dışarıdaki bir servise gönderilmez.",
  };
  const { extraction, synthesis } = routes;
  if (extraction === undefined || synthesis === undefined) {
    // The route table drops the matter roles of an endpoint that is not on
    // this computer or the lawyer's network: that is "the model is outside",
    // not "there is no model".
    if (localTrust !== undefined && localTrust !== null && !isOnPremisesTrust(localTrust)) return offMachine;
    const refused = (localRefusedReasonTr ?? "").trim();
    if (refused !== "") {
      return {
        allowed: false,
        code: "MODEL_UNAVAILABLE",
        reasonTr:
          "Bu inceleme için yerel model gerekli; ayarlı model adresi güven kurallarını geçmediği" +
          ` için kullanılmıyor. ${refused}`,
      };
    }
    return {
      allowed: false,
      code: "MODEL_UNAVAILABLE",
      reasonTr: "Bu inceleme için yerel model gerekli, ancak ayarlı bir yerel model yok.",
    };
  }
  if (!isOnPremisesTrust(extraction.trust) || !isOnPremisesTrust(synthesis.trust)) return offMachine;
  return { allowed: true, code: "OK", reasonTr: "Model gerektiren inceleme yerel modelle yapılabilir." };
}

/** Boolean form of decideModelTasks, for gates. */
export function policyAllowsModelTasks(policy: AiPolicy, routes: ModelTaskRoutes): boolean {
  return decideModelTasks(policy, routes).allowed;
}

// ---------------------------------------------------------------------------
// Health view (a NEW top-level `aiPolicy` key; `health.ai` is unchanged)
// ---------------------------------------------------------------------------

/** What health needs from a resolved route table (structural, no import cycle). */
export interface LocalModelFacts {
  readonly status: "not_configured" | "refused" | "configured";
  readonly model: string | null;
  readonly trust: EndpointTrust | null;
  readonly reason: string | null;
  readonly routes: ModelTaskRoutes;
}

export interface AiPolicyHealth {
  readonly policy: AiPolicy;
  readonly configuredPolicy: AiPolicy;
  readonly effectiveBoundary: DataBoundary;
  readonly localModel: {
    readonly state: "not_configured" | "refused" | "configured";
    readonly model: string | null;
    readonly trust: EndpointTrust | null;
    /** Lawyer-facing place ("bu bilgisayarda", ...); null when none. */
    readonly where: string | null;
    readonly usableForAnswers: boolean;
    readonly usableForMatterAnalysis: boolean;
    readonly reasonTr: string | null;
    /** Never probed from here: configured is not reachable. */
    readonly liveTested: false;
  };
  readonly cloud: {
    readonly configured: boolean;
    /** The policy and boundary permit it (still per request). */
    readonly allowed: boolean;
    readonly consent: "per-request";
  };
  readonly modelTasks: { readonly allowed: boolean; readonly code: ModelTaskCode; readonly reasonTr: string };
  readonly reasonTr: string;
  readonly warnings: readonly string[];
}

export function describeAiPolicy(
  state: EffectiveAiPolicy,
  local: LocalModelFacts,
  cloudConfigured: boolean,
): AiPolicyHealth {
  const configured = local.status === "configured";
  const usableForAnswers =
    state.policy !== "DETERMINISTIC_ONLY" &&
    configured &&
    (isOnPremisesTrust(local.trust) || state.policy === "CLOUD_ALLOWED");
  const modelTasks = decideModelTasks(
    state.policy,
    local.routes,
    local.trust,
    local.status === "refused" ? local.reason : null,
  );
  return {
    policy: state.policy,
    configuredPolicy: state.configuredPolicy,
    effectiveBoundary: state.boundary,
    localModel: {
      state: local.status,
      model: local.model,
      trust: local.trust,
      where: local.trust !== null ? trustLabelTr(local.trust) : null,
      usableForAnswers,
      usableForMatterAnalysis: modelTasks.allowed,
      reasonTr: local.reason,
      liveTested: false,
    },
    cloud: {
      configured: cloudConfigured,
      allowed:
        cloudConfigured && state.policy !== "DETERMINISTIC_ONLY" && state.policy !== "LOCAL_ONLY" &&
        state.boundary === "ALLOW_CLOUD",
      consent: "per-request",
    },
    modelTasks,
    reasonTr: state.reasonTr,
    warnings: state.warnings,
  };
}
