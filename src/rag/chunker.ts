/**
 * 已就位（AI 生成）—— 文档分块（s15 RAG 管线 Step 1）。
 *
 * 策略 = 递归段落分块：先按双换行切段落，单段超目标再按句末标点切。
 * 为什么不用语义分块？PremAI 2026 基准里递归分块 69% 准确率反而高于语义分块 54%——
 * 语义分块一个切点判错，后面全跟着错（误差累积）。递归分块简单且稳。
 * 目标 ~256 token/块（演示值，生产常用 512）；token≈字符数/4。
 */
export interface Chunk {
  id: string;
  text: string;
  source: string; // 来源文件
  index: number; // 在文档中的位置
  tokenEstimate: number;
}

const TARGET_TOKENS = 256;
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;

function makeChunk(source: string, text: string, index: number): Chunk {
  return {
    id: `${source}#${index}`,
    text,
    source,
    index,
    tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
  };
}

function splitSentences(para: string): string[] {
  // 按句末标点（中英）切，保留标点。
  return para.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [para];
}

export function chunkDocument(source: string, text: string): Chunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let current = '';
  let idx = 0;
  const flush = () => {
    if (current.trim()) {
      chunks.push(makeChunk(source, current.trim(), idx++));
      current = '';
    }
  };
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length > TARGET_CHARS) {
      // 单段超目标：按句子切
      flush();
      for (const sent of splitSentences(trimmed)) {
        if (current.length + sent.length > TARGET_CHARS && current.length > 0) flush();
        current += sent;
      }
      flush();
      continue;
    }
    if (current.length + trimmed.length + 2 > TARGET_CHARS && current.length > 0) flush();
    current += (current ? '\n\n' : '') + trimmed;
  }
  flush();
  return chunks;
}
