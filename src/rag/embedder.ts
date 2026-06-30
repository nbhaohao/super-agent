/**
 * 已就位（AI 生成）—— Embedding（s15 RAG 管线 Step 2）。
 *
 * 把文本转成向量，语义相近的文本向量距离更近。
 *   - createMockEmbedder：确定性哈希假向量（单测/无 key 也能跑，向量空间几何关系够用）。
 *   - createDashScopeEmbedder：调阿里云 text-embedding-v3 出真向量（默认 provider 同源）。
 * 同文本 + 同模型向量确定 → 加一层 Map 缓存，重复文本不重复烧钱。
 */
export type EmbeddingFn = (texts: string[]) => Promise<number[][]>;

const DIM = 128;

/** 确定性哈希假向量：同文本永远同向量，且词重叠多的文本向量更接近。 */
export function createMockEmbedder(): EmbeddingFn {
  return async (texts: string[]) =>
    texts.map((text) => {
      const vec = new Array(DIM).fill(0);
      for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
        let h = 0;
        for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
        vec[Math.abs(h) % DIM] += 1;
      }
      // L2 归一化，cosine 直接点积。
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
      return vec.map((x) => x / norm);
    });
}

export function createDashScopeEmbedder(apiKey: string): EmbeddingFn {
  return async (texts: string[]) => {
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-v3', input: texts, dimensions: DIM }),
    });
    const data = (await resp.json()) as any;
    return data.data.map((d: any) => d.embedding as number[]);
  };
}

/** 带缓存的 embed：命中缓存的文本不再请求。 */
export async function embed(fn: EmbeddingFn, texts: string[]): Promise<number[][]> {
  const cache = embed._cache;
  const missing = texts.filter((t) => !cache.has(t));
  if (missing.length > 0) {
    const vecs = await fn(missing);
    missing.forEach((t, i) => cache.set(t, vecs[i]));
  }
  return texts.map((t) => cache.get(t)!);
}
embed._cache = new Map<string, number[]>();

/** cosine 相似度（向量已 L2 归一化时即点积）。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
