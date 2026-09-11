import { EmbeddingConfig, type EmbeddingResolution } from "./embeddingConfig.js";

/** Explicit control-plane opt-in; does not enable extra Python MCP tools. */
export function localEmbeddingResolution(port: number): EmbeddingResolution {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("Invalid local embedding port");
  }
  return {
    enabled: true,
    config: new EmbeddingConfig({
      provider: "local",
      model: "intfloat/multilingual-e5-small:onnx-qint8",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      dimension: 384,
      promptStyle: "e5",
    }),
  };
}
