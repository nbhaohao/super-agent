/**
 * 已就位（AI 生成）—— RAG 工具（s15）。
 *
 * 把 RAG 管线注册成两个工具给 Agent：rag_ingest（导入文档：分块→向量化→入库）、
 * rag_search（混合检索 + MMR 去重）。工厂封装，闭包进 vectorStore + embedFn。
 */
import fs from 'node:fs';
import type { ToolDefinition } from './registry.js';
import { VectorStore } from '../rag/store.js';
import { chunkDocument } from '../rag/chunker.js';
import { embed, type EmbeddingFn } from '../rag/embedder.js';
import { hybridSearch, mmrSelect } from '../rag/search.js';

export function createRagTools(vectorStore: VectorStore, embedFn: EmbeddingFn): ToolDefinition[] {
  const ragIngest: ToolDefinition = {
    name: 'rag_ingest',
    description: '将文档导入知识库。内容会被分块、向量化后存储。',
    isReadOnly: false,
    isConcurrencySafe: false,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '文档路径' } },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async ({ path }: { path: string }) => {
      const text = fs.readFileSync(path, 'utf-8');
      const chunks = chunkDocument(path, text);
      const embeddings = await embed(embedFn, chunks.map((c) => c.text));
      vectorStore.addBatch(chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i] })));
      return `已导入 ${chunks.length} 个文档片段。知识库共 ${vectorStore.size()} 个片段。`;
    },
  };

  const ragSearch: ToolDefinition = {
    name: 'rag_search',
    description: '从知识库中搜索相关信息。返回最相关的文档片段。',
    isReadOnly: true,
    isConcurrencySafe: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询' },
        top_k: { type: 'number', description: '返回结果数量（默认 5）' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async ({ query, top_k = 5 }: { query: string; top_k?: number }) => {
      const hits = await hybridSearch(vectorStore, embedFn, query, top_k * 2);
      const deduped = mmrSelect(hits, top_k);
      if (deduped.length === 0) return '知识库无相关内容';
      return deduped
        .map((r, i) => `[${i + 1}] (${r.chunk.source} #${r.chunk.index}, score=${r.score.toFixed(3)})\n${r.chunk.text}`)
        .join('\n\n');
    },
  };

  return [ragIngest, ragSearch];
}
