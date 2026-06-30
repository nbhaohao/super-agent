import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore, type MemoryEntry } from '../src/memory/store.js';
import { chunkDocument } from '../src/rag/chunker.js';
import { VectorStore, type StoredChunk } from '../src/rag/store.js';
import { hybridSearch } from '../src/rag/search.js';
import type { EmbeddingFn } from '../src/rag/embedder.js';
import { validateEntry } from '../src/memory/validator.js';

// ── stage 1 · s14：MemoryStore 持久化记忆 ─────────────────────────────
describe('stage 1 · s14 MemoryStore 持久化记忆', () => {
  const base = join(tmpdir(), `sa-m04-mem-${process.pid}`);
  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  it('save：落 frontmatter 文件 + 写入索引行', () => {
    const store = new MemoryStore(base);
    const filename = store.save({
      name: '用户偏好 TS',
      description: '用户偏好 TypeScript，不喜欢 Python',
      type: 'user',
      content: '用户明确表示写示例代码优先用 TypeScript。',
    });
    expect(filename).toBe('user_用户偏好-ts.md');

    const fileBody = readFileSync(join(base, '.memory', filename), 'utf-8');
    expect(fileBody).toContain('type: user');
    expect(fileBody).toContain('用户明确表示写示例代码优先用 TypeScript。');

    const index = readFileSync(join(base, '.memory', 'MEMORY.md'), 'utf-8');
    expect(index).toContain('用户偏好 TS');
    expect(index).toContain(`(${filename})`);
  });

  it('save 同名：覆盖而非重复（索引里该 filename 只出现一次）', () => {
    const store = new MemoryStore(base);
    store.save({ name: '部署流程', description: '旧描述', type: 'project', content: 'v1' });
    const filename = store.save({ name: '部署流程', description: '新描述', type: 'project', content: 'v2' });

    const index = readFileSync(join(base, '.memory', 'MEMORY.md'), 'utf-8');
    const occurrences = index.split('\n').filter((l) => l.includes(`(${filename})`));
    expect(occurrences).toHaveLength(1);
    expect(index).toContain('新描述');
    expect(index).not.toContain('旧描述');
  });

  it('search：关键词命中 name/description/content', () => {
    const store = new MemoryStore(base);
    store.save({ name: '偏好', description: '喜欢 typescript', type: 'user', content: 'x' });
    store.save({ name: '看板', description: 'bug 跟踪地址', type: 'reference', content: 'y' });
    const hits = store.search('typescript');
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('偏好');
  });
});

// ── stage 2 · s15：RAG 混合检索 ───────────────────────────────────────
describe('stage 2 · s15 hybridSearch 混合检索', () => {
  // gen 已就位：chunker 直接绿
  it('chunkDocument：长文切多块，每块 tokenEstimate > 0（gen 已就位）', () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `第 ${i} 段：这是一段用于测试递归分块逻辑的中文内容，需要保证整篇文档的总长度超过目标分块阈值，从而被切成多个 chunk。`,
    ).join('\n\n');
    const chunks = chunkDocument('doc.md', text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokenEstimate > 0)).toBe(true);
  });

  // 确定性测试替身：固定 query 向量 + 手工构造的库
  const queryVec = [1, 0, 0];
  const mockEmbedder: EmbeddingFn = async (texts) => texts.map(() => queryVec);
  function chunk(id: string, text: string): StoredChunk['chunk'] {
    return { id, text, source: 'doc', index: 0, tokenEstimate: 1 };
  }
  function makeStore(): VectorStore {
    const store = new VectorStore();
    store.addBatch([
      { chunk: chunk('A', 'deploy the service deploy'), embedding: [1, 0, 0] },   // 向量+关键词都命中
      { chunk: chunk('B', 'unrelated random content here'), embedding: [0.8, 0.1, 0] }, // 仅向量
      { chunk: chunk('C', 'deploy deploy deploy now'), embedding: [0, 0, 1] },     // 仅关键词
    ]);
    return store;
  }

  it('两条路径都命中的文档排第一', async () => {
    const results = await hybridSearch(makeStore(), mockEmbedder, 'deploy', 3);
    expect(results[0].chunk.id).toBe('A');
  });

  it('返回结果数不超过 topK', async () => {
    const results = await hybridSearch(makeStore(), mockEmbedder, 'deploy', 2);
    expect(results.length).toBe(2);
  });
});

// ── stage 3 · s16：记忆体检 lint ──────────────────────────────────────
describe('stage 3 · s16 validateEntry 记忆体检', () => {
  function entry(over: Partial<MemoryEntry>): MemoryEntry {
    return { name: 'x', description: 'd', type: 'reference', content: '', filePath: 'reference_x.md', ...over };
  }

  it('引用的路径不存在 → stale_path', () => {
    const issues = validateEntry(entry({ type: 'project', content: '详见 src/totally-fake-xyz.ts 的实现' }));
    expect(issues.some((i) => i.kind === 'stale_path')).toBe(true);
  });

  it('超过类型 TTL 未被读过 → never_used', () => {
    const e = entry({ type: 'reference', content: 'oncall 看板', lastReadAt: Date.now() - 20 * 24 * 60 * 60 * 1000 });
    const issues = validateEntry(e); // reference TTL=14 天 < 20 天
    expect(issues.some((i) => i.kind === 'never_used')).toBe(true);
  });

  it('无路径、无 lastReadAt 的新记忆 → 无问题', () => {
    const issues = validateEntry(entry({ type: 'user', content: '用户偏好 TypeScript' }));
    expect(issues).toHaveLength(0);
  });
});
