// 已就位（AI 生成）——会话持久化（JSONL append-only, crash-safe, zero deps）
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

const DEFAULT_DIR = '.sessions';

export class SessionStore {
  private filePath: string;

  constructor(sessionId: string = 'default', dir: string = DEFAULT_DIR) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, `${sessionId}.jsonl`);
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  append(message: ModelMessage): void {
    appendFileSync(this.filePath, JSON.stringify(message) + '\n', 'utf-8');
  }

  appendAll(messages: ModelMessage[]): void {
    for (const m of messages) this.append(m);
  }

  load(): ModelMessage[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as ModelMessage);
  }
}
