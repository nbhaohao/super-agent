/**
 * 记忆体检 lint —— 给记忆库做定期扫描（m04 s16 后端核心，重点 review）。
 *
 * 记忆会变坏：污染（把推测当事实）、爆炸（只存不删信噪比降）、过期（代码变了记忆没跟上）、
 * 冲突（新旧矛盾）。lint 跟 eslint 一个意思——扫一遍把有问题的报出来，三类：
 *   - stale_path：记忆引用的路径已不存在；
 *   - never_used：按类型 TTL 太久没被读过（user 衰减最慢、reference 最快）；
 *   - duplicate_name：跟别的记忆重名（lintAll 跨条目检测）。
 *
 * 你写的：validateEntry() —— 单条记忆的 stale_path + never_used 判定。这是「记忆留多久」的决策落点。
 * 已就位（gen）：TTL_BY_TYPE / extractPaths / lintAll。
 */
import fs from "node:fs";
import path from "node:path";
import type { MemoryEntry, MemoryType } from "./store.js";

export type IssueKind = "stale_path" | "never_used" | "duplicate_name";

export interface ValidationIssue {
  kind: IssueKind;
  filePath: string;
  message: string;
}

// 按类型分级的保质期（天）：偏好长久、外部资源最易过期。
export const TTL_BY_TYPE: Record<MemoryType, number> = {
  user: 365,
  feedback: 90,
  project: 30,
  reference: 14,
};

const DAY_MS = 1000 * 60 * 60 * 24;

/** gen：从正文里抽出疑似文件路径（含 / 或带扩展名的 token）。 */
export function extractPaths(content: string): string[] {
  const matches =
    content.match(/[\w./-]*\/[\w./-]+|[\w-]+\.[a-z]{1,5}\b/gi) ?? [];
  return [...new Set(matches)];
}

// ── 你写（s16 核心）：单条记忆体检 ────────────────────────────────────
/**
 * 检查一条记忆，返回它的问题清单（无问题返回 []）。
 *
 * 实现步骤：
 *   1. const issues: ValidationIssue[] = []。
 *   2. 路径过期检测：对 extractPaths(entry.content) 的每个 p——
 *      const abs = path.isAbsolute(p) ? p : path.join(baseDir, p)；
 *      若 !fs.existsSync(abs) → push { kind:'stale_path', filePath: entry.filePath,
 *        message: `引用的路径不存在：${p}` }。
 *   3. 按类型 TTL 判长期未用：仅当 entry.lastReadAt 存在时——
 *      const ttl = TTL_BY_TYPE[entry.type] ?? 30；
 *      const days = (Date.now() - entry.lastReadAt) / DAY_MS；
 *      若 days > ttl → push { kind:'never_used', filePath: entry.filePath,
 *        message: `已 ${Math.floor(days)} 天没被读过，超过 ${entry.type} 类型的 ${ttl} 天保质期` }。
 *   4. return issues。
 */
export function validateEntry(
  entry: MemoryEntry,
  baseDir = ".",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const p of extractPaths(entry.content)) {
    const abs = path.isAbsolute(p) ? p : path.join(baseDir, p);
    if (!fs.existsSync(abs)) {
      issues.push({
        kind: "stale_path",
        filePath: entry.filePath,
        message: `引用的路径不存在：${p}`,
      });
    }
  }
  if (entry.lastReadAt) {
    const ttl = TTL_BY_TYPE[entry.type] ?? 30;
    const days = (Date.now() - entry.lastReadAt) / DAY_MS;
    if (days > ttl) {
      issues.push({
        kind: "never_used",
        filePath: entry.filePath,
        message: `已 ${Math.floor(days)} 天没被读过，超过 ${entry.type} 类型的 ${ttl} 天保质期`,
      });
    }
  }
  return issues;
}

// ── gen：全库体检（含跨条目重名检测）──
export function lintAll(
  entries: MemoryEntry[],
  baseDir = ".",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of entries) issues.push(...validateEntry(entry, baseDir));
  // 重名检测：同 name 出现多次。
  const byName = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  for (const [name, dups] of byName) {
    if (dups.length > 1) {
      for (const d of dups) {
        issues.push({
          kind: "duplicate_name",
          filePath: d.filePath,
          message: `与其他记忆重名：${name}（共 ${dups.length} 条）`,
        });
      }
    }
  }
  return issues;
}
