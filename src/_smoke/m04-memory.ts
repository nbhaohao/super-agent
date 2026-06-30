// m04 Memory + RAG —— 分阶段 smoke demo（默认 mock embedder，无需 key）
// 用法：pnpm v:s14 / v:s15 / v:s16
// 真实向量：设 DASHSCOPE_API_KEY 后 s15 自动切 createDashScopeEmbedder（见下）。
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../memory/store.js';
import { VectorStore } from '../rag/store.js';
import { chunkDocument } from '../rag/chunker.js';
import { createMockEmbedder, createDashScopeEmbedder, embed } from '../rag/embedder.js';
import { hybridSearch, mmrSelect } from '../rag/search.js';
import { lintAll } from '../memory/validator.js';

const stage = process.argv[2] ?? '14';
const base = mkdtempSync(join(tmpdir(), 'sa-m04-'));

if (stage === '14') {
  console.log('\n=== s14: 跨会话记忆 ===\n');
  const store = new MemoryStore(base);
  store.save({ name: '用户偏好 TS', description: '偏好 TypeScript', type: 'user', content: '写示例优先 TypeScript。' });
  store.save({ name: '部署流程', description: '生产部署用 pm2', type: 'project', content: '部署：pnpm build && pm2 reload。' });
  console.log('保存 2 条记忆。\nMEMORY.md 索引会注入每轮 system prompt：\n');
  console.log(store.buildPromptSection());
  console.log('\nsearch("typescript") →', store.search('typescript').map((e) => e.name));
}

if (stage === '15') {
  console.log('\n=== s15: RAG 混合检索 ===\n');
  // 4 条独立笔记 = 4 个 chunk（短文档各自成块，便于看清检索排序）
  const notes = [
    'deploy: pm2 stop 停旧进程，pm2 start 启新版本。',
    'TypeScript 类型系统在编译期捕获错误，是大型项目的护城河。',
    '数据库迁移上周出过事故，改表结构前务必备份。',
    'pm2 reload 零停机重启，比 restart 更安全。',
  ];
  const embedder = process.env.DASHSCOPE_API_KEY
    ? createDashScopeEmbedder(process.env.DASHSCOPE_API_KEY)
    : createMockEmbedder();
  console.log(`embedder: ${process.env.DASHSCOPE_API_KEY ? 'DashScope(真向量, 能处理中文语义)' : 'mock(无需 key, 仅英文/字面 token 友好)'}`);
  const store = new VectorStore();
  for (const [i, note] of notes.entries()) {
    const chunks = chunkDocument(`note-${i}.md`, note);
    const embeddings = await embed(embedder, chunks.map((c) => c.text));
    store.addBatch(chunks.map((c, j) => ({ chunk: c, embedding: embeddings[j] })));
  }
  console.log(`知识库共 ${store.size()} 个片段。`);
  const hits = mmrSelect(await hybridSearch(store, embedder, 'pm2', 3), 2);
  console.log(`\nquery "pm2" → top ${hits.length}（两条 pm2 笔记应排前）：`);
  for (const h of hits) console.log(`  [score=${h.score.toFixed(3)}] ${h.chunk.text}`);
}

if (stage === '16') {
  console.log('\n=== s16: 记忆体检 lint ===\n');
  const store = new MemoryStore(base);
  store.save({ name: '老路径', description: '引用已删除文件', type: 'project', content: '详见 src/gone-forever.ts' });
  store.save({ name: '老路径', description: '重名条目', type: 'project', content: '内容不同的同名记忆' });
  const entries = store.list();
  // 模拟一条很久没读的记忆
  entries[0].lastReadAt = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const issues = lintAll(entries, base);
  console.log(`lint 发现 ${issues.length} 个问题：`);
  for (const i of issues) console.log(`  [${i.kind}] ${i.filePath} — ${i.message}`);
}

try { rmSync(base, { recursive: true, force: true }); } catch {}
