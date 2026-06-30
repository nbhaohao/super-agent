/**
 * 已就位（AI 生成）—— memory 工具（s14；s16 复用 lint/delete）。
 *
 * MemoryStore 是底层存储，但模型不能直接调 TS 方法——它需要一个「工具」来操作记忆，
 * 跟 read_file 一样。工厂函数封装：把 store 实例闭包进去，index.ts 一行 register 即可。
 * action 路由：save / search / list / delete / lint（lint 在 s16 validator 落地后才有内容）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from './registry.js';
import { MemoryStore, type MemoryType } from '../memory/store.js';

export function createMemoryTool(memoryStore: MemoryStore, baseDir = '.'): ToolDefinition {
  return {
    name: 'memory',
    description:
      '管理跨会话长期记忆。action=save 存一条（需 name/description/type/content）；search 按关键词搜；list 列全部；delete 删一条（传 filename）。',
    isReadOnly: false,
    isConcurrencySafe: false,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'search', 'list', 'delete'], description: '操作类型' },
        name: { type: 'string', description: 'save 用：记忆名（人类可读）' },
        description: { type: 'string', description: 'save 用：一句话摘要，检索靠它判相关性' },
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'save 用：记忆类型' },
        content: { type: 'string', description: 'save 用：正文' },
        query: { type: 'string', description: 'search 用：查询词' },
        filename: { type: 'string', description: 'delete 用：文件名（如 user_xxx.md）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      const { action } = input;
      if (action === 'save') {
        const filename = memoryStore.save({
          name: input.name,
          description: input.description,
          type: input.type as MemoryType,
          content: input.content,
        });
        return `已保存记忆：${filename}`;
      }
      if (action === 'search') {
        const hits = memoryStore.search(input.query ?? '');
        if (hits.length === 0) return '无匹配记忆';
        return hits.map((e) => `[${e.type}] ${e.name} — ${e.description}`).join('\n');
      }
      if (action === 'list') {
        const all = memoryStore.list();
        return all.length === 0 ? '记忆库为空' : all.map((e) => `${e.filePath} — ${e.description}`).join('\n');
      }
      if (action === 'delete') {
        const target = path.join(baseDir, '.memory', input.filename);
        if (!fs.existsSync(target)) return `文件不存在：${input.filename}`;
        fs.rmSync(target);
        return `已删除：${input.filename}`;
      }
      return `未知 action：${action}`;
    },
  };
}
