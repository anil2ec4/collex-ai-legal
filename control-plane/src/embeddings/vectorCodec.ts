/**
 * Durable vector representation without pgvector (W20 phase E).
 *
 * A vector is stored as little-endian float32 (4 bytes per dimension; the
 * `chunk_vectors_width` CHECK enforces the length) and L2-normalized at write
 * time, so cosine similarity at search time is a plain dot product. Endianness
 * is explicit in both directions: a vector written on this Windows machine and
 * read on the Mac appliance must mean the same numbers.
 */

/** L2-normalize; undefined for a zero, empty or non-finite vector. */
export function l2Normalize(vector: readonly number[]): Float32Array | undefined {
  if (vector.length === 0) return undefined;
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return undefined;
    norm += value * value;
  }
  if (norm === 0) return undefined;
  const scale = 1 / Math.sqrt(norm);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = (vector[i] as number) * scale;
  return out;
}

export function encodeVector(vector: Float32Array): Buffer {
  const out = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i += 1) out.writeFloatLE(vector[i] as number, i * 4);
  return out;
}

export function decodeVector(bytes: Uint8Array, dimensions: number): Float32Array | undefined {
  if (bytes.byteLength !== dimensions * 4) return undefined;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) out[i] = buffer.readFloatLE(i * 4);
  return out;
}

/** Dot product of two equal-length vectors (cosine, when both are unit). */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] as number) * (b[i] as number);
  return sum;
}
