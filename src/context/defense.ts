// 已就位（AI 生成）——上下文三层防线（截断 + TTL 修剪 + Token 估算）
import type { ModelMessage } from 'ai';

const CONTEXT_WINDOW = 200_000; // tokens
// chars≈4×tokens；乘以 4 得字符阈值
const SINGLE_MAX_CHARS = CONTEXT_WINDOW * 0.5 * 4;    // 单条 50% window
const BUDGET_MAX_CHARS = CONTEXT_WINDOW * 0.75 * 4;   // 总量 75% window
const KEEP_HEAD_TAIL = 1500;                           // soft-prune 后保留字符数
const SOFT_TTL_MS = 5 * 60 * 1_000;                   // 5 min
const HARD_TTL_MS = 10 * 60 * 1_000;                  // 10 min

// Layer 0：Token 追踪（精确 API 值 + 增量估算）
export class TokenTracker {
  private lastPreciseCount = 0;
  private pendingChars = 0;

  updateFromAPI(inputTokens: number): void {
    this.lastPreciseCount = inputTokens;
    this.pendingChars = 0; // API 已算入，pending 清零
  }

  addChars(chars: number): void {
    this.pendingChars += chars;
  }

  estimate(): number {
    return this.lastPreciseCount + Math.ceil(this.pendingChars / 4);
  }
}

// chars/4 * 1.2 = 中文/代码混合时 token 偏高修正
export function estimateMessageTokens(messages: ModelMessage[]): number {
  const totalChars = messages.reduce(
    (sum, msg) => sum + JSON.stringify(msg.content).length,
    0,
  );
  return Math.ceil((totalChars / 4) * 1.2);
}

// Head 60% + Tail 40% 保留，中间省略标注
function keepHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const dropped = text.length - head - tail;
  return text.slice(0, head) + `\n... [省略 ${dropped} 字符] ...\n` + text.slice(-tail);
}

function toolOutputChars(msg: ModelMessage): number {
  if (msg.role !== 'tool') return 0;
  return ((msg as any).content as any[]).reduce(
    (sum: number, p: any) => sum + String(p.output ?? '').length,
    0,
  );
}

// 含 error/失败/错误 关键词的工具结果跳过修剪——保留负向经验防重复踩坑
function hasError(msg: ModelMessage): boolean {
  if (msg.role !== 'tool') return false;
  return ((msg as any).content as any[]).some((p: any) => {
    const out = String(p.output ?? '').toLowerCase();
    return out.includes('error') || out.includes('失败') || out.includes('错误');
  });
}

function truncateToolMsg(msg: ModelMessage, maxChars: number): ModelMessage {
  return {
    ...msg,
    content: ((msg as any).content as any[]).map((p: any) => {
      const out = String(p.output ?? '');
      return out.length > maxChars ? { ...p, output: keepHeadTail(out, maxChars) } : p;
    }),
  } as ModelMessage;
}

export interface TruncateResult {
  messages: ModelMessage[];
  truncated: number; // Pass1 单条截断数
  compacted: number; // Pass2 批量清空数
}

/**
 * s12 你写 —— 两遍工具结果防线（token 压力下保住上下文不爆窗）。
 *
 * 可用的工具件（已就位）：toolOutputChars(msg) 取一条 tool 消息的总输出字符数；
 *   truncateToolMsg(msg, maxChars) 把该消息的 output 做 Head/Tail 截断；
 *   常量 SINGLE_MAX_CHARS（单条上限 = 50% 窗）/ BUDGET_MAX_CHARS（总量上限 = 75% 窗）/ KEEP_HEAD_TAIL。
 *
 * Pass1（单条过大）：任一 tool 消息 output > SINGLE_MAX_CHARS → truncateToolMsg 截断，truncated++。
 * Pass2（总量超预算）：Pass1 后总字符 > BUDGET_MAX_CHARS → 从最新往旧累加预算，
 *   预算花完后更旧的 tool 消息（且 > KEEP_HEAD_TAIL）整条 output 换 '[tool result compacted]'，compacted++。
 */
export function truncateToolResults(messages: ModelMessage[]): TruncateResult {
  // TODO: stage s12
  // 1. Pass1：map messages，tool 消息 toolOutputChars > SINGLE_MAX_CHARS → truncateToolMsg(msg, SINGLE_MAX_CHARS)，truncated++
  // 2. 算 Pass1 结果的总 toolOutputChars；若 <= BUDGET_MAX_CHARS 直接返回
  // 3. Pass2：从头 map，用 remaining=BUDGET_MAX_CHARS 逐条扣预算（保留新近的）；
  //    预算扣光后、且该条 chars > KEEP_HEAD_TAIL → output 整体换 '[tool result compacted]'，compacted++
  throw new Error('TODO: stage s12 — truncateToolResults');
}

export interface PruneResult {
  messages: ModelMessage[];
  softPruned: number;
  hardPruned: number;
}

// TTL 修剪：软 5min（keepHeadTail）→ 硬 10min（全清）；错误结果跳过
export function ttlPrune(
  messages: ModelMessage[],
  timestamps: Map<number, number>,
): PruneResult {
  const now = Date.now();
  let softPruned = 0;
  let hardPruned = 0;

  const result = messages.map((msg, i): ModelMessage => {
    if (msg.role !== 'tool') return msg;
    if (hasError(msg)) return msg;

    const ts = timestamps.get(i);
    if (!ts) return msg;
    const age = now - ts;

    if (age >= HARD_TTL_MS) {
      hardPruned++;
      return {
        ...msg,
        content: ((msg as any).content as any[]).map((p: any) => ({
          ...p,
          output: '[hard-pruned: expired]',
        })),
      } as ModelMessage;
    }

    if (age >= SOFT_TTL_MS) {
      softPruned++;
      return {
        ...msg,
        content: ((msg as any).content as any[]).map((p: any) => {
          const out = String(p.output ?? '');
          return { ...p, output: keepHeadTail(out, KEEP_HEAD_TAIL) };
        }),
      } as ModelMessage;
    }

    return msg;
  });

  return { messages: result, softPruned, hardPruned };
}

export interface DefenseResult {
  messages: ModelMessage[];
  truncated: number;
  compacted: number;
  softPruned: number;
  hardPruned: number;
  tokenEstimate: number;
}

export function applyDefense(
  messages: ModelMessage[],
  timestamps: Map<number, number> = new Map(),
): DefenseResult {
  const r1 = truncateToolResults(messages);
  const r2 = ttlPrune(r1.messages, timestamps);
  return {
    messages: r2.messages,
    truncated: r1.truncated,
    compacted: r1.compacted,
    softPruned: r2.softPruned,
    hardPruned: r2.hardPruned,
    tokenEstimate: estimateMessageTokens(r2.messages),
  };
}
