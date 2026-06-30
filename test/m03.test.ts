import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

import { SessionStore } from '../src/context/session.js';
import {
  PromptBuilder,
  coreRules,
  toolGuide,
  deferredToolsHint,
  sessionContext,
} from '../src/context/prompt-pipe.js';
import { microcompact } from '../src/context/compaction.js';
import {
  TokenTracker,
  estimateMessageTokens,
  truncateToolResults,
  ttlPrune,
  applyDefense,
} from '../src/context/defense.js';
import { normalizeUsage, UsageTracker, PRICE_TABLE } from '../src/obs/cost.js';
import { renderContextMatrix } from '../src/context/view.js';

// ── stage 1 · s10：SessionStore JSONL + PromptBuilder Pipe ─────────────
describe('stage 1 · s10 SessionStore + PromptBuilder', () => {
  const tmpDir = join(tmpdir(), `sa-m03-${process.pid}`);
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('SessionStore：append/load 往返正确', () => {
    const store = new SessionStore('test', tmpDir);
    const msg: ModelMessage = { role: 'user', content: 'hello' };
    store.append(msg);
    const loaded = store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('SessionStore：exists() 文件创建前 false，创建后 true', () => {
    const store = new SessionStore('exists-test', tmpDir);
    expect(store.exists()).toBe(false);
    store.append({ role: 'user', content: 'hi' });
    expect(store.exists()).toBe(true);
  });

  it('PromptBuilder：pipe 返回 null 时被过滤，不进最终 prompt', () => {
    const ctx = { toolCount: 0, deferredToolSummary: '', sessionMessageCount: 0, sessionId: 'x' };
    const builder = new PromptBuilder()
      .pipe('a', () => 'always')
      .pipe('b', () => null)   // null = skip
      .pipe('c', () => 'also');
    const result = builder.build(ctx);
    // 只有 2 段，null 被滤掉
    expect(result.split('\n\n')).toHaveLength(2);
    expect(result).toContain('always');
    expect(result).toContain('also');
  });

  it('PromptBuilder：toolGuide 在 toolCount=0 时跳过', () => {
    const ctx = { toolCount: 0, deferredToolSummary: '', sessionMessageCount: 0, sessionId: 'x' };
    const debug = new PromptBuilder().pipe('guide', toolGuide()).debug(ctx);
    expect(debug).toContain('⏭ skip');
  });

  it('PromptBuilder：4 个内置 pipe 全配，toolCount > 0 时无 skip', () => {
    const ctx = { toolCount: 3, deferredToolSummary: '...tools...', sessionMessageCount: 5, sessionId: 'sess' };
    const builder = new PromptBuilder()
      .pipe('rules', coreRules())
      .pipe('guide', toolGuide())
      .pipe('deferred', deferredToolsHint())
      .pipe('session', sessionContext());
    const debug = builder.debug(ctx);
    expect(debug).not.toContain('⏭ skip');
    expect(debug.split('\n')).toHaveLength(4);
  });
});

// ── stage 2 · s11：Microcompact ────────────────────────────────────────
describe('stage 2 · s11 microcompact 清理旧工具结果', () => {
  function toolMsg(toolName: string, output: string): ModelMessage {
    return {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: '1', toolName, output }] as any,
    };
  }

  it('超过 3 条 read_file 结果：最旧的被清空，最近 3 条保留', () => {
    const msgs: ModelMessage[] = [
      toolMsg('read_file', 'A'),
      toolMsg('read_file', 'B'),
      toolMsg('read_file', 'C'),
      toolMsg('read_file', 'D'),
      toolMsg('read_file', 'E'),
    ];
    const { messages, cleared } = microcompact(msgs);
    expect(cleared).toBe(2);
    expect((messages[0] as any).content[0].output).toBe('[tool result cleared]');
    expect((messages[1] as any).content[0].output).toBe('[tool result cleared]');
    expect((messages[4] as any).content[0].output).toBe('E'); // 最新的保留
  });

  it('edit_file 不在 CLEARABLE_TOOLS，不被清', () => {
    const msgs: ModelMessage[] = [
      toolMsg('edit_file', 'edited'),
      toolMsg('read_file', 'R1'),
      toolMsg('read_file', 'R2'),
      toolMsg('read_file', 'R3'),
      toolMsg('read_file', 'R4'), // 触发 R1 被清
    ];
    const { messages } = microcompact(msgs);
    // edit_file 是 index 0，不在 CLEARABLE_TOOLS，不被清
    expect((messages[0] as any).content[0].output).toBe('edited');
  });

  it('少于等于 3 条 tool 消息：全部保留，cleared=0', () => {
    const msgs: ModelMessage[] = [
      toolMsg('read_file', 'A'),
      toolMsg('read_file', 'B'),
      toolMsg('read_file', 'C'),
    ];
    const { cleared } = microcompact(msgs);
    expect(cleared).toBe(0);
  });
});

// ── stage 3 · s12：Context Defense 三层防线 ────────────────────────────
describe('stage 3 · s12 TokenTracker + truncate + ttlPrune', () => {
  function bigToolMsg(chars: number): ModelMessage {
    return {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: '1', toolName: 'read_file', output: 'X'.repeat(chars) }] as any,
    };
  }

  it('TokenTracker：updateFromAPI 重置 pendingChars，estimate 正确累加', () => {
    const t = new TokenTracker();
    t.addChars(400);
    expect(t.estimate()).toBe(100); // 400/4
    t.updateFromAPI(200); // 精确值 200，pending 清零
    expect(t.estimate()).toBe(200);
    t.addChars(800); // 800/4=200 → 200+200=400
    expect(t.estimate()).toBe(400);
  });

  it('estimateMessageTokens：返回 > 0 且随消息增长', () => {
    const msgs: ModelMessage[] = [{ role: 'user', content: 'hello world' }];
    const est1 = estimateMessageTokens(msgs);
    msgs.push({ role: 'assistant', content: [{ type: 'text', text: 'A'.repeat(200) }] as any });
    const est2 = estimateMessageTokens(msgs);
    expect(est1).toBeGreaterThan(0);
    expect(est2).toBeGreaterThan(est1);
  });

  it('truncateToolResults Pass1：单条超 50% window → Head/Tail 截断', () => {
    // SINGLE_MAX_CHARS = 200000 * 0.5 * 4 = 400000
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      bigToolMsg(500_000),
    ];
    const { messages, truncated } = truncateToolResults(msgs);
    expect(truncated).toBe(1);
    const out = (messages[1] as any).content[0].output as string;
    expect(out).toContain('省略');
    expect(out.length).toBeLessThan(500_000);
  });

  it('ttlPrune：超软 TTL 5min 的工具结果被 keepHeadTail 压缩', () => {
    const now = Date.now();
    const msgs: ModelMessage[] = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: '1', toolName: 'read_file', output: 'X'.repeat(3000) }] as any,
      },
    ];
    const timestamps = new Map([[0, now - 6 * 60 * 1000]]); // 6min ago
    const { softPruned, messages } = ttlPrune(msgs, timestamps);
    expect(softPruned).toBe(1);
    const out = (messages[0] as any).content[0].output as string;
    expect(out.length).toBeLessThan(3000); // 被截短了
  });

  it('ttlPrune：含 error 关键词的工具结果跳过修剪', () => {
    const now = Date.now();
    const msgs: ModelMessage[] = [
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: '1', toolName: 'run_cmd', output: 'error: command not found' }] as any,
      },
    ];
    const timestamps = new Map([[0, now - 6 * 60 * 1000]]);
    const { softPruned, hardPruned } = ttlPrune(msgs, timestamps);
    expect(softPruned).toBe(0);
    expect(hardPruned).toBe(0);
  });

  it('applyDefense：整合三层，返回结构完整', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'test' },
      bigToolMsg(1000),
    ];
    const result = applyDefense(msgs, new Map());
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(result.messages).toHaveLength(2);
    expect(typeof result.truncated).toBe('number');
    expect(typeof result.softPruned).toBe('number');
  });
});

// ── stage 4 · s13：normalizeUsage + UsageTracker + /context ───────────
describe('stage 4 · s13 Cost Tracking + Prompt Cache', () => {
  it('normalizeUsage (OpenAI)：cachedInputTokens 从 inputTokens 减出，不重复计', () => {
    const raw = { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 300 };
    const n = normalizeUsage(raw);
    expect(n.inputTokens).toBe(700);      // 1000 - 300
    expect(n.cacheReadTokens).toBe(300);
    expect(n.outputTokens).toBe(200);
    expect(n.cacheWriteTokens).toBe(0);
  });

  it('normalizeUsage (Anthropic)：providerMetadata 单列，inputTokens 不变', () => {
    const raw = { inputTokens: 1000, outputTokens: 200 };
    const meta = { anthropic: { cacheCreationInputTokens: 100, cacheReadInputTokens: 50 } };
    const n = normalizeUsage(raw, meta);
    expect(n.inputTokens).toBe(1000);  // 不减
    expect(n.cacheWriteTokens).toBe(100);
    expect(n.cacheReadTokens).toBe(50);
  });

  it('PRICE_TABLE deepseek-chat：cacheRead 价格低于 input（省钱）', () => {
    const p = PRICE_TABLE['deepseek-chat'];
    expect(p).toBeDefined();
    expect(p.cacheReadPerM).toBeLessThan(p.inputPerM);
  });

  it('UsageTracker：有 cacheRead 时 savedCost > 0，totalCost < baselineCost', () => {
    const tracker = new UsageTracker();
    tracker.record(
      { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0 },
      'deepseek-chat',
    );
    const t = tracker.totals();
    expect(t.savedCost).toBeGreaterThan(0);
    expect(t.totalCost).toBeLessThan(t.baselineCost);
  });

  it('UsageTracker.formatPanel()：包含 Cost / Saved 字段', () => {
    const tracker = new UsageTracker();
    tracker.record(
      { inputTokens: 500, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 0 },
      'deepseek-chat',
    );
    const panel = tracker.formatPanel();
    expect(panel).toContain('Cost:');
    expect(panel).toContain('Saved:');
  });

  it('renderContextMatrix：返回 16 行，包含 modelName 和 token 统计', () => {
    const matrix = renderContextMatrix({
      systemChars: 2000,
      toolChars: 8000,
      messageChars: 5000,
      contextWindow: 200_000,
      modelName: 'deepseek-chat',
    });
    const lines = matrix.split('\n');
    expect(lines).toHaveLength(16);
    expect(matrix).toContain('deepseek-chat');
    expect(matrix).toContain('tokens');
  });
});
