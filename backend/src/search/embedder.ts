type Embedder = {
  embed: (text: string) => Promise<Float32Array>;
  dim: () => number;
};

let cached: Promise<Embedder> | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (cached) return cached;
  cached = (async () => {
    // Lazy-load to keep startup fast and avoid ESM/CJS edge cases.
    const { pipeline } = (await import("@xenova/transformers")) as any;
    const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    let cachedDim: number | null = null;

    return {
      async embed(text: string) {
        // Keep inputs bounded. Indexer already caps chunks; this caps queries.
        const trimmed = text.length > 12_000 ? text.slice(0, 12_000) : text;
        const out = await extractor(trimmed, { pooling: "mean", normalize: true });
        const vec = out.data as Float32Array;
        if (cachedDim == null) cachedDim = vec.length;
        return vec;
      },
      dim() {
        if (cachedDim == null) {
          // Model is known to be 384-d, but we only expose dim once we have a vector.
          return 384;
        }
        return cachedDim;
      },
    };
  })();
  return cached;
}

export function float32ToBytes(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  // sql.js returns BLOBs as Uint8Array; interpret as Float32Array without copying.
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

