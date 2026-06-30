/**
 * 已就位（AI 生成）—— 内存向量库（s15 RAG 管线 Step 3 存储）。
 *
 * chunk + embedding 一起存。课程用内存数组——搜索逻辑跟生产的 SQLite + sqlite-vec + FTS5
 * 完全一样，只是换了存储介质（生产考量见 stage 页 ⑤）。进程退出即丢，文档少够用。
 */
import type { Chunk } from './chunker.js';

export interface StoredChunk {
  chunk: Chunk;
  embedding: number[];
}

export class VectorStore {
  private items: StoredChunk[] = [];

  addBatch(items: StoredChunk[]): void {
    this.items.push(...items);
  }
  getAll(): StoredChunk[] {
    return this.items;
  }
  size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items = [];
  }
}
