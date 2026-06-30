import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';

import { createModel } from '../src/providers/registry.js';
import { createMockModel } from '../src/providers/mock-model.js';
import { loadConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';
import { streamChat } from '../src/core/chat.js';
import { calculatorTool, weatherTool, tools } from '../src/tools/index.js';
import { agentLoop, type BudgetState } from '../src/core/agent-loop.js';
import { createLoopDetector } from '../src/core/loop-detection.js';
import { isRetryable, calculateDelay } from '../src/core/retry.js';

const sink = { write() {} }; // 静默 stdout，测试不打印流式

describe('stage 1 · s1 多 provider registry + 流式对话', () => {
  it('mock provider 实现 LanguageModelV2 接口（spec v2），SDK 分不清真假', () => {
    const model = createModel('mock');
    expect(model.specificationVersion).toBe('v2');
  });

  it('未知 provider 抛清晰的 ConfigError', () => {
    expect(() => createModel('zzz' as never)).toThrow(ConfigError);
  });

  it('选了真实 provider 却没配 key → 启动期就抛 ConfigError（不留到首次网络调用）', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv); // 空 env：provider=deepseek，无 key
    expect(() => createModel('deepseek', cfg)).toThrow(ConfigError);
  });

  it('streamChat 回流文本并把 assistant 消息追加进历史', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: '你好' }];
    const text = await streamChat(createMockModel(), messages, { out: sink });
    expect(text.length).toBeGreaterThan(0);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' });
  });
});

describe('stage 2 · s2 Agent Loop + 工具', () => {
  it('工具 execute 真正干活（calculator 求值）', async () => {
    const out = await calculatorTool.execute!({ expression: '2 + 3 * 4' }, { toolCallId: 't', messages: [] } as never);
    expect(out).toBe('2 + 3 * 4 = 14');
  });

  it('Agent Loop：调工具 → 拿结果 → 收尾文本，stoppedBy=final（多步）', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: '北京天气怎么样？' }];
    const r = await agentLoop(createMockModel(), tools, messages, { out: sink });
    expect(r.stoppedBy).toBe('final');
    expect(r.steps).toBeGreaterThanOrEqual(2); // 第1步调工具，第2步出文本
    // 历史里应出现一条 tool 角色消息（工具结果被喂回）
    expect(messages.some((m) => m.role === 'tool')).toBe(true);
  });
});

describe('stage 3 · s3 三层防护（循环检测 / 重试 / 预算）', () => {
  it('循环检测：同工具同参数反复调，5 次警告、8 次熔断', () => {
    const det = createLoopDetector();
    const call = () => { det.record('get_weather', { city: '北京' }); det.recordResult('get_weather', { city: '北京' }, '晴'); };
    for (let i = 0; i < 4; i++) call();
    expect(det.detect('get_weather', { city: '北京' })).toMatchObject({ stuck: false }); // 第5次调用前，历史4条
    call();
    expect(det.detect('get_weather', { city: '北京' })).toMatchObject({ stuck: true, level: 'warning' }); // 历史5条
    for (let i = 0; i < 3; i++) call(); // 共8条
    expect(det.detect('get_weather', { city: '北京' })).toMatchObject({ stuck: true, level: 'critical' });
  });

  it('错误分类：429/超时/5xx 可重试，4xx 不可重试', () => {
    expect(isRetryable(new Error('API error 429 Too Many Requests'))).toBe(true);
    expect(isRetryable(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryable(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryable(new Error('400 Bad Request'))).toBe(false);
    expect(isRetryable('not an error')).toBe(false);
  });

  it('指数退避 + 抖动：attempt1≈500ms(±25%)，attempt2≈1000ms(±25%)', () => {
    const d1 = calculateDelay(1);
    const d2 = calculateDelay(2);
    expect(d1).toBeGreaterThanOrEqual(375);
    expect(d1).toBeLessThanOrEqual(625);
    expect(d2).toBeGreaterThanOrEqual(750);
    expect(d2).toBeLessThanOrEqual(1250);
  });

  it('Token 预算：累计超限 → stoppedBy=budget', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: '测试预算' }];
    const budget: BudgetState = { used: 0, limit: 4000 }; // 一步模拟 4500 > 4000
    const r = await agentLoop(createMockModel(), tools, messages, { out: sink, budget });
    expect(r.stoppedBy).toBe('budget');
    expect(budget.used).toBeGreaterThan(4000);
  });

  it('API 容错：可重试错误自动重试后成功（stoppedBy=final）', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: '测试重试' }];
    const model = createMockModel({ retryFails: 1 }); // 先抛一次 429，重试后成功
    const r = await agentLoop(model, tools, messages, { out: sink, maxRetries: 3 });
    expect(r.stoppedBy).toBe('final');
  });
});
