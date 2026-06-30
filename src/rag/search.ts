/**
 * 混合检索 —— 整个 RAG 管线最关键的一环（m04 s15 后端核心，重点 review）。
 *
 * 单用向量搜索会漏精确关键词（如 `pm2 stop` 这类语义隔得远但字面命中），
 * 单用关键词又会漏语义相关。混合检索 = 跑两条路径各取所长，归一化后按权重合并。
 * OpenClaw 默认 70% 向量 + 30% 关键词。
 *
 * 你写的：hybridSearch() —— 两路召回 → min-max 归一化 → 加权合并 → 排序。这是「召回质量」的决策落点。
 * 已就位（gen）：keywordSearch(BM25) / normalizeMinMax / mmrSelect / jaccardSimilarity / tokenize。
 */
import type { Chunk } from './chunker.js';
import { VectorStore } from './store.js';
import { embed, cosineSimilarity, type EmbeddingFn } from './embedder.js';

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;
const CANDIDATE_MULTIPLIER = 4; // 先各取 topK*4 候选，避免好结果在某条路径排第 6 被截断
const MMR_LAMBDA = 0.7; // MMR：70% 看相关性，30% 看多样性

// ── 你写（s15 核心）：混合检索 ────────────────────────────────────────
/**
 * 混合检索：向量路径 + 关键词路径，归一化合并排序，返回 topK。
 *
 * 实现步骤：
 *   1. const all = store.getAll()；空库直接 return []。
 *   2. const candidateCount = Math.min(topK * CANDIDATE_MULTIPLIER, all.length)。
 *   3. 向量路径：const [queryVec] = await embed(embedFn, [query])；
 *      对 all 每个 item 算 cosineSimilarity(queryVec, item.embedding)，
 *      sort 降序，slice(0, candidateCount) → vecHits（{chunk, score}）。
 *   4. 关键词路径：const terms = tokenize(query)；kwRaw = keywordSearch(terms, all.map(i=>i.chunk))；
 *      sort 降序，slice(0, candidateCount) → kwHits（{chunk, score}）。
 *   5. 归一化：两条路径分数范围不可比（cosine 是 0~1，BM25 范围不定），各自过 normalizeMinMax
 *      映射到 [0,1]，再按 chunk.id 建 Map：vecNorm / kwNorm。
 *   6. 合并：取两路出现过的所有 chunk.id，combined = (vecNorm??0)*VECTOR_WEIGHT + (kwNorm??0)*KEYWORD_WEIGHT。
 *      两条路径都命中的文档得分最高。
 *   7. 组装 SearchResult[]，sort 降序，slice(0, topK)，return。
 */
export async function hybridSearch(
  store: VectorStore,
  embedFn: EmbeddingFn,
  query: string,
  topK = 5,
): Promise<SearchResult[]> {
  throw new Error('TODO: s15 —— 实现 hybridSearch()：两路召回 → 归一化 → 加权合并 → topK');
}

// ── gen：关键词路径（BM25）──
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean);
}

/** BM25 打分：经典词频 × idf 公式，返回每个 chunk 的原始分（范围不定，靠 normalize 收敛）。 */
export function keywordSearch(terms: string[], chunks: Chunk[]): SearchResult[] {
  const k1 = 1.5;
  const b = 0.75;
  const N = chunks.length || 1;
  const docs = chunks.map((c) => tokenize(c.text));
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = (term: string) => docs.filter((d) => d.includes(term)).length;
  return chunks.map((chunk, i) => {
    const doc = docs[i];
    let score = 0;
    for (const term of terms) {
      const f = doc.filter((t) => t === term).length;
      if (f === 0) continue;
      const idf = Math.log((N - df(term) + 0.5) / (df(term) + 0.5) + 1);
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgdl)));
    }
    return { chunk, score };
  });
}

/** min-max 归一化到 [0,1]：把区分度拉满（比 sigmoid 更适合已在 [0,1) 的分数）。 */
export function normalizeMinMax(scores: number[]): number[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  return scores.map((s) => (s - min) / range);
}

/** Jaccard 相似度：两个文本词集交集/并集，给 MMR 当多样性度量（零额外 API 成本）。 */
export function jaccardSimilarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size || 1;
  return inter / union;
}

/** MMR 去重：选结果时兼顾相关性与多样性，避免 top 几名是同话题的重复段落。 */
export function mmrSelect(results: SearchResult[], topK: number): SearchResult[] {
  if (results.length === 0) return [];
  const selected: SearchResult[] = [results[0]];
  const remaining = results.slice(1);
  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim = Math.max(
        ...selected.map((s) => jaccardSimilarity(s.chunk.text, remaining[i].chunk.text)),
      );
      const mmr = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}
