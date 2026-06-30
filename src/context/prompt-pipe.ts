/**
 * s10 你写 —— 模块化 Prompt 构建管道（先静后动，利好 KV cache）。
 *
 * 核心想法：把 system prompt 拆成若干 section（规则 / 工具指南 / 延迟工具 / 会话上下文），
 * 每个 section 是一个 PipeFn——返回字符串则入选，返回 null 则本轮缺席（被过滤掉）。
 * 这样「条件 section」（如无工具时不渲染工具指南）变成纯数据驱动，且静态 section 排前、
 * 动态 section 排后 → 同一前缀稳定 → 命中 KV cache。
 */
export interface PromptContext {
  toolCount: number;
  deferredToolSummary: string;
  sessionMessageCount: number;
  sessionId: string;
}

// 返回 null = 本轮此 section 缺席（被过滤，不进最终 prompt）
export type PipeFn = (ctx: PromptContext) => string | null;

export class PromptBuilder {
  private pipes: Array<{ name: string; fn: PipeFn }> = [];

  // 注册一个 section（链式），返回 this 以便 .pipe().pipe()...
  pipe(name: string, fn: PipeFn): this {
    this.pipes.push({ name, fn });
    return this;
  }

  build(ctx: PromptContext): string {
    // TODO: stage s10
    // 1. 对每个 pipe 调 fn(ctx)
    // 2. 过滤掉返回 null 的（该 section 本轮缺席）
    // 3. 用 '\n\n' 连接剩下的 section 字符串
    throw new Error('TODO: stage s10 — PromptBuilder.build');
  }

  // 调试输出：每个 pipe 的状态（命中→字符数 / 缺席→skip），帮你看清本轮 prompt 由哪些 section 组成
  debug(ctx: PromptContext): string {
    // TODO: stage s10
    // 对每个 pipe：fn(ctx) 为 null → `[name] ⏭ skip`，否则 `[name] ✓ <len>c`；逐行 '\n' 连接
    throw new Error('TODO: stage s10 — PromptBuilder.debug');
  }
}

// ── 内置 Pipe 函数（先静后动：coreRules > toolGuide > deferredTools > sessionContext）──
// 你写：体会「静态恒在 / 动态可缺席」——coreRules 恒返回；其余按 ctx 条件返回 null。

export const coreRules = (): PipeFn => () => {
  // TODO: stage s10 — 恒返回 Super Agent 的核心行为规则（静态，永不缺席，放最前利好 cache）
  throw new Error('TODO: stage s10 — coreRules');
};

export const toolGuide = (): PipeFn => (_ctx) => {
  // TODO: stage s10 — toolCount === 0 → null（无工具不渲染）；否则返回工具使用指南（含活跃数）
  throw new Error('TODO: stage s10 — toolGuide');
};

export const deferredToolsHint = (): PipeFn => (_ctx) => {
  // TODO: stage s10 — 有 deferredToolSummary 就原样返回，空串 → null
  throw new Error('TODO: stage s10 — deferredToolsHint');
};

export const sessionContext = (): PipeFn => (_ctx) => {
  // TODO: stage s10 — sessionMessageCount === 0 → null；否则返回会话上下文（sessionId + 历史条数）
  throw new Error('TODO: stage s10 — sessionContext');
};
