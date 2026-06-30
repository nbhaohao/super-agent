// 已就位（AI 生成）——Token 用量归一化 + 费用追踪（s13：Cache & Cost）
export interface ModelPricing {
  inputPerM: number;      // $/1M input tokens
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
}

export const PRICE_TABLE: Record<string, ModelPricing> = {
  'deepseek-chat':     { inputPerM: 0.27,  outputPerM: 1.10,  cacheWritePerM: 0.27,  cacheReadPerM: 0.027 },
  'deepseek-reasoner': { inputPerM: 0.55,  outputPerM: 2.19,  cacheWritePerM: 0.55,  cacheReadPerM: 0.14  },
  'claude-sonnet-4-6': { inputPerM: 3.0,   outputPerM: 15.0,  cacheWritePerM: 3.75,  cacheReadPerM: 0.30  },
  'claude-opus-4-8':   { inputPerM: 15.0,  outputPerM: 75.0,  cacheWritePerM: 18.75, cacheReadPerM: 1.50  },
  'gpt-4o':            { inputPerM: 2.5,   outputPerM: 10.0,  cacheWritePerM: 2.5,   cacheReadPerM: 1.25  },
  'mock':              { inputPerM: 0,     outputPerM: 0,     cacheWritePerM: 0,     cacheReadPerM: 0     },
};

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * 归一化 AI SDK v5 的 stepUsage + providerMetadata：
 *
 * OpenAI / DeepSeek 格式：cachedInputTokens 已包含在 inputTokens 里
 *   → 须减出来单独计入 cacheReadTokens，避免重复计费
 *
 * Anthropic 格式：cacheCreation / cacheRead 单列在 providerMetadata
 *   → 直接读出，inputTokens 本身不含 cache，不需减
 */
export function normalizeUsage(
  usage: { inputTokens?: number; outputTokens?: number; [k: string]: unknown },
  providerMeta?: Record<string, unknown>,
): NormalizedUsage {
  // TODO: stage s13
  // 目标：抹平两类厂商的 cache 计数口径，产出统一的 NormalizedUsage。
  // ① OpenAI / DeepSeek：cachedInputTokens（或 cached_tokens）已【含】在 inputTokens 里
  //    → cacheReadTokens = 该值；inputTokens 要【减掉】它（否则缓存部分被按全价重复计）
  // ② Anthropic：缓存单列在 providerMeta.anthropic.{cacheCreationInputTokens, cacheReadInputTokens}
  //    → 直接取；inputTokens 本身【不含】 cache，【不要】减
  // 缺省字段一律按 0；返回 { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
  throw new Error('TODO: stage s13 — normalizeUsage');
}

function computeCost(u: NormalizedUsage, p: ModelPricing): number {
  return (
    u.inputTokens * p.inputPerM +
    u.outputTokens * p.outputPerM +
    u.cacheWriteTokens * p.cacheWritePerM +
    u.cacheReadTokens * p.cacheReadPerM
  ) / 1_000_000;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  baselineCost: number; // 假设无 cache 的理论成本
  savedCost: number;    // baselineCost - totalCost
}

export class UsageTracker {
  private records: Array<NormalizedUsage & { model: string }> = [];

  record(usage: NormalizedUsage, model: string): void {
    this.records.push({ ...usage, model });
  }

  totals(): UsageTotals {
    const sum = (f: keyof NormalizedUsage) =>
      this.records.reduce((s, r) => s + r[f], 0);

    let totalCost = 0;
    let baselineCost = 0;

    for (const r of this.records) {
      const p = PRICE_TABLE[r.model] ?? PRICE_TABLE['mock'];
      totalCost += computeCost(r, p);
      // baseline = cache read 按 input 价计
      baselineCost += computeCost(
        { ...r, inputTokens: r.inputTokens + r.cacheReadTokens, cacheReadTokens: 0 },
        p,
      );
    }

    return {
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      cacheWriteTokens: sum('cacheWriteTokens'),
      totalCost,
      baselineCost,
      savedCost: baselineCost - totalCost,
    };
  }

  formatPanel(): string {
    const t = this.totals();
    const $ = (n: number) => `$${n.toFixed(6)}`;
    return [
      '── Usage ──────────────────────────────',
      `  Input:         ${t.inputTokens.toLocaleString()} tokens`,
      `  Output:        ${t.outputTokens.toLocaleString()} tokens`,
      `  Cache Read:    ${t.cacheReadTokens.toLocaleString()} tokens`,
      `  Cache Write:   ${t.cacheWriteTokens.toLocaleString()} tokens`,
      `  Cost:          ${$(t.totalCost)}`,
      `  Without cache: ${$(t.baselineCost)}`,
      `  Saved:         ${$(t.savedCost)}`,
      '────────────────────────────────────────',
    ].join('\n');
  }
}
