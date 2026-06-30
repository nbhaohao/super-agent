/**
 * 循环检测（s3 核心 · 后端核心，重点 review）—— 第一层防护「短路保护」。
 *
 * 抓的是「语义死循环」：模型一直在调工具但没进展。三种模式：
 *   · generic_repeat 同工具同参数反复调  · ping_pong 两操作 A→B→A→B 来回  · 全局熔断
 * 思路：给每次调用算指纹（工具名 + 参数稳定序列化后哈希）→ 维护滑动窗口（最近 30 条）→
 *   同输入且同输出 = 无进展。三级响应（先软后硬，给模型自救机会，避免误杀正常工作的 Agent）：
 *   Warning 5 次（注入提醒）→ Critical 8 次（阻断）→ 全局熔断 10 次（强停）。
 *   （演示阈值；生产通常 10/20/30）
 *
 * 设计：用工厂返回独立实例（闭包持状态），不是模块全局——可并发、可在测试里隔离。
 */
import { createHash } from 'node:crypto';

const HISTORY_SIZE = 30;
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 8;
const BREAKER_THRESHOLD = 10;

export type DetectorKind = 'generic_repeat' | 'ping_pong' | 'global_circuit_breaker';
export type DetectionResult =
  | { stuck: false }
  | { stuck: true; level: 'warning' | 'critical'; detector: DetectorKind; count: number; message: string };

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  resultHash?: string;
}

/** 参数稳定序列化：key 排序，保证 {a,b} 和 {b,a} 指纹一致。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${shortHash(stableStringify(params))}`;
}

export interface LoopDetector {
  /** 工具调用发生时记一笔（在 detect 之后调）。 */
  record(toolName: string, params: unknown): void;
  /** 工具结果回来时，补到最近一条无结果的同调用记录上。 */
  recordResult(toolName: string, params: unknown, result: unknown): void;
  /** 在执行某工具调用前问一句：卡住了吗？ */
  detect(toolName: string, params: unknown): DetectionResult;
  reset(): void;
}

export function createLoopDetector(): LoopDetector {
  let history: ToolCallRecord[] = [];

  function getNoProgressStreak(toolName: string, argsHash: string): number {
    let streak = 0;
    let lastResultHash: string | undefined;
    for (let i = history.length - 1; i >= 0; i--) {
      const r = history[i];
      if (r.toolName !== toolName || r.argsHash !== argsHash) continue;
      if (!r.resultHash) continue;
      if (!lastResultHash) { lastResultHash = r.resultHash; streak = 1; continue; }
      if (r.resultHash !== lastResultHash) break;
      streak++;
    }
    return streak;
  }

  function getPingPongCount(currentHash: string): number {
    if (history.length < 3) return 0;
    const last = history[history.length - 1];
    let otherHash: string | undefined;
    for (let i = history.length - 2; i >= 0; i--) {
      if (history[i].argsHash !== last.argsHash) { otherHash = history[i].argsHash; break; }
    }
    if (!otherHash) return 0;
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const expected = count % 2 === 0 ? last.argsHash : otherHash;
      if (history[i].argsHash !== expected) break;
      count++;
    }
    if (currentHash === otherHash && count >= 2) return count + 1;
    return 0;
  }

  return {
    record(toolName, params) {
      history.push({ toolName, argsHash: hashToolCall(toolName, params) });
      if (history.length > HISTORY_SIZE) history.shift();
    },
    recordResult(toolName, params, result) {
      const argsHash = hashToolCall(toolName, params);
      const resultHash = shortHash(stableStringify(result));
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].toolName === toolName && history[i].argsHash === argsHash && !history[i].resultHash) {
          history[i].resultHash = resultHash;
          break;
        }
      }
    },
    detect(toolName, params): DetectionResult {
      const argsHash = hashToolCall(toolName, params);

      const noProgress = getNoProgressStreak(toolName, argsHash);
      if (noProgress >= BREAKER_THRESHOLD) {
        return { stuck: true, level: 'critical', detector: 'global_circuit_breaker', count: noProgress, message: `[熔断] ${toolName} 已重复 ${noProgress} 次且无进展，强制停止` };
      }

      const pingPong = getPingPongCount(argsHash);
      if (pingPong >= CRITICAL_THRESHOLD) {
        return { stuck: true, level: 'critical', detector: 'ping_pong', count: pingPong, message: `[熔断] 检测到乒乓循环（${pingPong} 次交替），强制停止` };
      }
      if (pingPong >= WARNING_THRESHOLD) {
        return { stuck: true, level: 'warning', detector: 'ping_pong', count: pingPong, message: `[警告] 检测到乒乓循环（${pingPong} 次交替），建议换个思路` };
      }

      const repeat = history.filter((h) => h.toolName === toolName && h.argsHash === argsHash).length;
      if (repeat >= CRITICAL_THRESHOLD) {
        return { stuck: true, level: 'critical', detector: 'generic_repeat', count: repeat, message: `[熔断] ${toolName} 相同参数已调用 ${repeat} 次，强制停止` };
      }
      if (repeat >= WARNING_THRESHOLD) {
        return { stuck: true, level: 'warning', detector: 'generic_repeat', count: repeat, message: `[警告] ${toolName} 相同参数已调用 ${repeat} 次，你可能陷入了重复` };
      }

      return { stuck: false };
    },
    reset() {
      history = [];
    },
  };
}
