import { expect, it } from "vitest";
import { localEmbeddingResolution } from "../../src/retrieval/localEmbeddingConfig.js";

it("configures the pinned local model without changing the child process environment", () => {
  const before = { ...process.env };
  const resolution = localEmbeddingResolution(8918);
  expect(resolution.enabled).toBe(true);
  if (!resolution.enabled) throw new Error("Local resolution disabled");
  expect(resolution.config.toJSON()).toMatchObject({
    provider: "local", model: "intfloat/multilingual-e5-small:onnx-qint8",
    baseUrl: "http://127.0.0.1:8918/v1", dimension: 384, promptStyle: "e5",
    hasApiKey: false,
  });
  expect(process.env).toEqual(before);
});

it.each([0, -1, 65536, 1.5, NaN])("rejects invalid port %s", (port) => {
  expect(() => localEmbeddingResolution(port)).toThrow(RangeError);
});
