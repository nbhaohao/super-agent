/**
 * 已就位（AI 生成）—— 本地模拟模型，手动实现 AI SDK 5 的 LanguageModelV2 接口。
 *
 * 为什么手搓而不是用 ai/test：实现同一个 LanguageModelV2 接口，SDK（generateText/
 * streamText）就分不清真假——这是单测确定性 + 不烧 token 的根，也是后续每个模块的测试替身。
 *
 * 能模拟三件事，覆盖 m01 全部场景：
 *   · 流式文本（s1）
 *   · 工具调用：识别天气/计算意图 → 发 tool-call；看到 tool 结果后 → 收尾文本（s2）
 *   · 三层防护场景（s3）：「测试死循环」永远调同一工具；「测试重试」前两次抛 429；
 *     「测试预算」每步报高 token 用量
 */
import type { LanguageModelV2, LanguageModelV2StreamPart, LanguageModelV2Content } from '@ai-sdk/provider';
import { randomUUID } from 'node:crypto';

type Prompt = Parameters<LanguageModelV2['doStream']>[0]['prompt'];

const CITIES: Record<string, string> = {
  北京: '晴，15-25°C，东南风 2 级',
  上海: '多云，18-22°C，西南风 3 级',
  深圳: '阵雨，22-28°C，南风 2 级',
};

function textOf(msg: Prompt[number]): string {
  if (typeof msg.content === 'string') return msg.content;
  return (msg.content as Array<{ type: string; text?: string }>)
    .map((p) => (p.type === 'text' ? p.text ?? '' : ''))
    .join('');
}

function lastUserText(prompt: Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === 'user') return textOf(prompt[i]);
  }
  return '';
}

function hasIntent(prompt: Prompt, kw: string): boolean {
  return prompt.some((m) => m.role === 'user' && textOf(m).includes(kw));
}

function pickCity(text: string): string {
  return Object.keys(CITIES).find((c) => text.includes(c)) ?? '北京';
}

type Decision =
  | { kind: 'text'; text: string; budgetHeavy?: boolean }
  | { kind: 'tool'; toolName: string; input: Record<string, unknown> }
  | { kind: 'error'; message: string };

/** 决定这一步 mock 要做什么——纯函数（除「测试重试」的失败计数由调用处传入）。 */
function decide(prompt: Prompt, retryFails: number): Decision {
  // 死循环场景：不管看到什么，永远调同一个工具同一参数 → 交给循环检测去抓
  if (hasIntent(prompt, '测试死循环')) {
    return { kind: 'tool', toolName: 'get_weather', input: { city: '北京' } };
  }
  // 重试场景：前 retryFails 次抛可重试错误（429）
  if (hasIntent(prompt, '测试重试') && retryFails > 0) {
    return { kind: 'error', message: 'API error 429 Too Many Requests' };
  }
  // 预算场景：正常出文本，但报高 token 用量
  if (hasIntent(prompt, '测试预算')) {
    return { kind: 'text', text: '这是一条用于演示 Token 预算的回复（本步模拟消耗较多 token）。', budgetHeavy: true };
  }
  // 看到工具结果 → 收尾给一句最终文本（让 Agent Loop 自然结束）
  const last = prompt[prompt.length - 1];
  if (last && last.role === 'tool') {
    return { kind: 'text', text: '好的，我已经拿到工具返回的结果并据此作答。' };
  }
  // 否则按最后一句 user 意图判断
  const t = lastUserText(prompt);
  if (t.includes('天气') || t.toLowerCase().includes('weather')) {
    return { kind: 'tool', toolName: 'get_weather', input: { city: pickCity(t) } };
  }
  if (/计算|算一下|多少|[0-9]\s*[-+*/]/.test(t)) {
    const expr = t.match(/[-+*/().\d\s]{3,}/)?.[0]?.trim() || '2 + 3 * 4';
    return { kind: 'tool', toolName: 'calculator', input: { expression: expr } };
  }
  if (t.includes('你好') || t.includes('hello') || t.includes('介绍')) {
    return { kind: 'text', text: '你好！我是 Super Agent 的模拟模型，机制和真实 API 完全一致。' };
  }
  return { kind: 'text', text: '我是模拟模型。填入 DEEPSEEK_API_KEY 并把 LLM_PROVIDER 设为 deepseek 即可切到真实模型。' };
}

function usageFor(heavy: boolean) {
  return heavy
    ? { inputTokens: 3000, outputTokens: 1500, totalTokens: 4500 }
    : { inputTokens: 12, outputTokens: 24, totalTokens: 36 };
}

function textStream(text: string, heavy: boolean, delayMs: number): ReadableStream<LanguageModelV2StreamPart> {
  const id = 'txt-' + randomUUID();
  const parts: LanguageModelV2StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id },
    ...[...text].map((ch): LanguageModelV2StreamPart => ({ type: 'text-delta', id, delta: ch })),
    { type: 'text-end', id },
    { type: 'finish', finishReason: 'stop', usage: usageFor(heavy) },
  ];
  return emit(parts, delayMs);
}

function toolStream(toolName: string, input: Record<string, unknown>, delayMs: number): ReadableStream<LanguageModelV2StreamPart> {
  const parts: LanguageModelV2StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'call-' + randomUUID(), toolName, input: JSON.stringify(input) },
    { type: 'finish', finishReason: 'tool-calls', usage: usageFor(false) },
  ];
  return emit(parts, delayMs);
}

function emit(parts: LanguageModelV2StreamPart[], delayMs: number): ReadableStream<LanguageModelV2StreamPart> {
  let i = 0;
  return new ReadableStream({
    start(controller) {
      const next = () => {
        if (i < parts.length) {
          controller.enqueue(parts[i++]);
          if (delayMs > 0) setTimeout(next, delayMs);
          else next();
        } else {
          controller.close();
        }
      };
      next();
    },
  });
}

export interface MockOptions {
  /** 流式逐字间隔（ms）。默认 0（测试快）；smoke 想要打字机效果可设 30。 */
  delayMs?: number;
  /** 「测试重试」场景下，开头连续抛多少次 429（默认 2）。 */
  retryFails?: number;
}

export function createMockModel(options: MockOptions = {}): LanguageModelV2 {
  const delayMs = options.delayMs ?? 0;
  let remainingFails = options.retryFails ?? 2;

  return {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},

    async doGenerate({ prompt }) {
      const d = decide(prompt, remainingFails);
      if (d.kind === 'error') { remainingFails--; throw new Error(d.message); }
      const content: LanguageModelV2Content[] =
        d.kind === 'tool'
          ? [{ type: 'tool-call', toolCallId: 'call-' + randomUUID(), toolName: d.toolName, input: JSON.stringify(d.input) }]
          : [{ type: 'text', text: d.text }];
      return {
        content,
        finishReason: d.kind === 'tool' ? 'tool-calls' : 'stop',
        usage: usageFor(d.kind === 'text' && !!d.budgetHeavy),
        warnings: [],
      };
    },

    async doStream({ prompt }) {
      const d = decide(prompt, remainingFails);
      if (d.kind === 'error') { remainingFails--; throw new Error(d.message); }
      const stream =
        d.kind === 'tool'
          ? toolStream(d.toolName, d.input, delayMs)
          : textStream(d.text, !!d.budgetHeavy, delayMs);
      return { stream };
    },
  };
}
