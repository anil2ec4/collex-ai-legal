/**
 * W21 verifier fixes for the AI policy: the reason codes and warnings say
 * WHERE the text went and WHY a model was not used — never "the local model
 * wrote it" when an outside service did, never "no model" when the model is
 * merely outside this computer.
 */

import { describe, expect, it } from "vitest";
import {
  AI_UNAVAILABLE_LOCAL_USED_MESSAGE_TR,
  AI_UNAVAILABLE_OFF_MACHINE_USED_MESSAGE_TR,
  decideModelTasks,
  decideProvider,
  describeAiPolicy,
  resolveEffectiveAiPolicy,
} from "../../src/llm/aiPolicy.js";

const onMachine = { trust: "LOCAL_PROCESS" as const };

describe("decideProvider · warnings name where the answer was written", () => {
  it("CLOUD_ALLOWED + outside 'local' endpoint + no cloud key: the warning says an OUTSIDE server wrote it", () => {
    const decision = decideProvider({
      policy: "CLOUD_ALLOWED",
      boundary: "ALLOW_CLOUD",
      localConfigured: true,
      localTrust: "CLOUD",
      requestAsksLocal: false,
      requestConsentsCloud: true,
      cloudConfigured: false,
    });
    expect(decision.drafter).toBe("local");
    const messages = decision.warnings.map((warning) => warning.messageTr);
    expect(messages).toContain(AI_UNAVAILABLE_OFF_MACHINE_USED_MESSAGE_TR);
    expect(messages).not.toContain(AI_UNAVAILABLE_LOCAL_USED_MESSAGE_TR);
  });

  it("the on-machine case keeps the local-model wording", () => {
    const decision = decideProvider({
      policy: "CLOUD_ALLOWED",
      boundary: "ALLOW_CLOUD",
      localConfigured: true,
      localTrust: "LOCAL_PROCESS",
      requestAsksLocal: false,
      requestConsentsCloud: true,
      cloudConfigured: false,
    });
    expect(decision.warnings.map((warning) => warning.messageTr)).toContain(AI_UNAVAILABLE_LOCAL_USED_MESSAGE_TR);
  });

  it("LOCAL_ONLY + useLocalAi + no local model carries MODEL_UNAVAILABLE, as the default path does", () => {
    const base = {
      policy: "LOCAL_ONLY" as const,
      boundary: "LOCAL_ONLY" as const,
      localConfigured: false,
      localTrust: null,
      requestConsentsCloud: false,
      cloudConfigured: false,
    };
    const asked = decideProvider({ ...base, requestAsksLocal: true });
    const implicit = decideProvider({ ...base, requestAsksLocal: false });
    expect(asked.drafter).toBe("rule-based");
    expect(asked.warnings.map((warning) => warning.code)).toContain("MODEL_UNAVAILABLE");
    expect(implicit.warnings.map((warning) => warning.code)).toContain("MODEL_UNAVAILABLE");
  });
});

describe("decideModelTasks · an outside endpoint is named, not reported missing", () => {
  it("roles dropped by the route table for an outside endpoint -> MODEL_OFF_MACHINE", () => {
    expect(decideModelTasks("CLOUD_ALLOWED", {}, "CLOUD").code).toBe("MODEL_OFF_MACHINE");
    expect(decideModelTasks("LOCAL_PREFERRED", {}, "CLOUD").code).toBe("MODEL_OFF_MACHINE");
  });

  it("no endpoint at all stays MODEL_UNAVAILABLE; DETERMINISTIC_ONLY wins over both", () => {
    expect(decideModelTasks("LOCAL_PREFERRED", {}, null).code).toBe("MODEL_UNAVAILABLE");
    expect(decideModelTasks("LOCAL_PREFERRED", {}).code).toBe("MODEL_UNAVAILABLE");
    expect(decideModelTasks("DETERMINISTIC_ONLY", {}, "CLOUD").code).toBe("AI_POLICY_DETERMINISTIC");
    expect(decideModelTasks("LOCAL_ONLY", { extraction: onMachine, synthesis: onMachine }, "LOCAL_PROCESS").allowed).toBe(true);
  });

  it("health reports MODEL_OFF_MACHINE for a refused outside endpoint", () => {
    const health = describeAiPolicy(
      resolveEffectiveAiPolicy({}),
      { status: "refused", model: null, trust: "CLOUD", reason: "dışarıda", routes: {} },
      false,
    );
    expect(health.modelTasks.code).toBe("MODEL_OFF_MACHINE");
    expect(health.localModel.usableForMatterAnalysis).toBe(false);
  });
});
