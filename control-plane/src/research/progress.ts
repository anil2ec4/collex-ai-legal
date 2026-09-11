/**
 * Live-research progress vocabulary (W12-F).
 *
 * The live executor emits one event when a gateway tool call STARTS and one
 * when it ENDS; `ProgressTracker` folds those into the `progress` block the
 * async run endpoint (GET /v1/research/runs/{runId}) returns:
 *
 *   { steps: [{ at, label, tool, status, count?, ms?, errorKind? }],
 *     toolCalls, fetches }
 *
 * `label` is LAWYER TURKISH for every tool family the 54-tool gateway can be
 * asked for ("Yargıtay/Danıştay kararları aranıyor", "Belge çekiliyor 2/6",
 * "Kaynak sunucular kontrol ediliyor"…); `tool` keeps the raw tool name for
 * the trace; `status` is the machine code ('running' | 'ok' | 'failed' |
 * 'timeout') and `errorKind` the typed FailureKind of a failed call.
 */

export type ProgressStepStatus = "running" | "ok" | "failed" | "timeout";

export interface ResearchProgressStep {
  /** ISO timestamp of the step's LAST update (start, then end). */
  at: string;
  /** Turkish label, e.g. "Mevzuat aranıyor". */
  label: string;
  /** Raw gateway tool name (machine). */
  tool: string;
  status: ProgressStepStatus;
  /** Typed hit/document count of a finished call, when the payload had one. */
  count?: number;
  /** Wall time of the call in ms once finished. */
  ms?: number;
  /** FailureKind of a failed/timed-out call (machine code, English). */
  errorKind?: string;
}

export interface ResearchProgress {
  steps: ResearchProgressStep[];
  toolCalls: number;
  fetches: number;
}

export interface ToolCallProgressEvent {
  phase: "start" | "end";
  at: string;
  tool: string;
  capability: string;
  label: string;
  status: ProgressStepStatus;
  count?: number;
  ms?: number;
  errorKind?: string;
}

export type ProgressListener = (event: ToolCallProgressEvent) => void;

// ---------------------------------------------------------------------------
// Turkish labels per tool family
// ---------------------------------------------------------------------------

const EXACT_TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  search: "Yargıtay/Danıştay kararları aranıyor",
  search_bedesten_unified: "Yargıtay/Danıştay kararları aranıyor",
  search_bedesten_semantic: "Yargıtay/Danıştay kararları aranıyor (anlamsal)",
  search_emsal_detailed_decisions: "Emsal (UYAP) kararları aranıyor",
  search_anayasa_unified: "Anayasa Mahkemesi kararları aranıyor",
  search_uyusmazlik_decisions: "Uyuşmazlık Mahkemesi kararları aranıyor",
  search_kik_v2_decisions: "Kamu İhale Kurulu kararları aranıyor",
  search_rekabet_kurumu_decisions: "Rekabet Kurumu kararları aranıyor",
  search_sayistay_unified: "Sayıştay kararları aranıyor",
  search_kvkk_decisions: "KVKK kararları aranıyor",
  search_bddk_decisions: "BDDK kararları aranıyor",
  search_btk_decisions: "BTK kararları aranıyor",
  search_gib_ozelge: "GİB özelgeleri aranıyor",
  search_sigorta_tahkim_decisions: "Sigorta Tahkim kararları aranıyor",
  search_mevzuat: "Mevzuat aranıyor",
  search_kanun: "Kanunlar aranıyor",
  search_khk: "Kanun hükmünde kararnameler aranıyor",
  search_cbk: "Cumhurbaşkanlığı kararnameleri aranıyor",
  search_cbyonetmelik: "Cumhurbaşkanlığı yönetmelikleri aranıyor",
  search_cbbaskankarar: "Cumhurbaşkanı kararları aranıyor",
  search_cbgenelge: "Cumhurbaşkanlığı genelgeleri aranıyor",
  search_kurum_yonetmelik: "Kurum yönetmelikleri aranıyor",
  search_teblig: "Tebliğler aranıyor",
  search_tuzuk: "Tüzükler aranıyor",
  get_mevzuat_content: "Mevzuat metni çekiliyor",
  get_mevzuat_gerekce: "Madde gerekçesi çekiliyor",
  get_mevzuat_madde_tree: "Madde ağacı çekiliyor",
  check_government_servers_health: "Kaynak sunucular kontrol ediliyor",
});

const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "caseLaw.search": "İçtihat aranıyor",
  "legislation.search": "Mevzuat aranıyor",
  "regulator.search": "Kurum kararları aranıyor",
  "document.fetch": "Belge çekiliyor",
  "document.searchWithin": "Belge içinde aranıyor",
  "source.health": "Kaynak sunucular kontrol ediliyor",
});

/**
 * Turkish progress label for one tool call. `position` (1-based index and
 * the fetch budget) decorates document fetches: "Belge çekiliyor 2/6".
 */
export function progressLabelForTool(
  toolName: string | undefined,
  capability: string,
  position?: { index: number; total: number },
): string {
  const suffix =
    position !== undefined && position.total > 0 ? ` ${position.index}/${position.total}` : "";
  if (capability === "document.fetch") {
    const exact = toolName !== undefined ? EXACT_TOOL_LABELS[toolName] : undefined;
    return `${exact ?? "Belge çekiliyor"}${suffix}`;
  }
  if (toolName !== undefined) {
    const exact = EXACT_TOOL_LABELS[toolName];
    if (exact !== undefined) return exact;
    if (toolName.startsWith("search_within_")) return "Mevzuat metni içinde aranıyor";
    if (toolName.startsWith("get_") || toolName === "fetch") return `Belge çekiliyor${suffix}`;
    if (toolName.startsWith("search_")) return "Kaynak aranıyor";
  }
  return CAPABILITY_LABELS[capability] ?? "Kaynak sorgulanıyor";
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/** Folds start/end events into the `progress` block; safe to snapshot any time. */
export class ProgressTracker {
  readonly progress: ResearchProgress = { steps: [], toolCalls: 0, fetches: 0 };

  /** Bound listener for `RunResearchOptions.onProgress`. */
  readonly listener: ProgressListener = (event) => this.record(event);

  record(event: ToolCallProgressEvent): void {
    if (event.phase === "start") {
      this.progress.steps.push({
        at: event.at,
        label: event.label,
        tool: event.tool,
        status: "running",
      });
      this.progress.toolCalls += 1;
      if (event.capability === "document.fetch") this.progress.fetches += 1;
      return;
    }
    const step = this.findRunning(event.tool);
    const finished: ResearchProgressStep = {
      at: event.at,
      label: event.label,
      tool: event.tool,
      status: event.status,
      ...(event.count !== undefined ? { count: event.count } : {}),
      ...(event.ms !== undefined ? { ms: event.ms } : {}),
      ...(event.errorKind !== undefined ? { errorKind: event.errorKind } : {}),
    };
    if (step === undefined) {
      // An end without a start (a listener attached mid-call): still recorded.
      this.progress.steps.push(finished);
      return;
    }
    Object.assign(step, finished);
  }

  /** Immutable copy for an HTTP response. */
  snapshot(): ResearchProgress {
    return {
      steps: this.progress.steps.map((step) => ({ ...step })),
      toolCalls: this.progress.toolCalls,
      fetches: this.progress.fetches,
    };
  }

  private findRunning(tool: string): ResearchProgressStep | undefined {
    for (let i = this.progress.steps.length - 1; i >= 0; i -= 1) {
      const step = this.progress.steps[i] as ResearchProgressStep;
      if (step.tool === tool && step.status === "running") return step;
    }
    return undefined;
  }
}
