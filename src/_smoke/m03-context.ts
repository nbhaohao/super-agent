// m03 Context Engineering — 分阶段 smoke demo（无 LLM 调用）
// 用法：pnpm v:s10 / v:s11 / v:s12 / v:s13
import { rmSync } from 'node:fs';
import type { ModelMessage } from 'ai';

import { SessionStore } from '../context/session.js';
import { PromptBuilder, coreRules, toolGuide, deferredToolsHint, sessionContext } from '../context/prompt-pipe.js';
import { microcompact } from '../context/compaction.js';
import { TokenTracker, applyDefense } from '../context/defense.js';
import { normalizeUsage, UsageTracker } from '../obs/cost.js';
import { renderContextMatrix } from '../context/view.js';

const stage = process.argv[2] ?? '10';

function toolMsg(toolName: string, output: string): ModelMessage {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName, output }] as any };
}

if (stage === '10') {
  console.log('\n=== s10: SessionStore + PromptBuilder ===\n');

  const store = new SessionStore('smoke-demo', '.sessions-smoke');
  store.append({ role: 'user', content: 'hello m03 smoke' });
  store.append({ role: 'assistant', content: [{ type: 'text', text: 'world' }] as any });
  const loaded = store.load();
  console.log(`SessionStore: 写入 2 条 → 读回 ${loaded.length} 条 ✓`);

  const ctx = { toolCount: 3, deferredToolSummary: '可用工具: tool_a, tool_b...', sessionMessageCount: 2, sessionId: 'smoke-demo' };
  const builder = new PromptBuilder()
    .pipe('rules', coreRules())
    .pipe('guide', toolGuide())
    .pipe('deferred', deferredToolsHint())
    .pipe('session', sessionContext());

  console.log('\nPromptBuilder.debug():');
  console.log(builder.debug(ctx));
  console.log('\nbuild() (前 200 字符):');
  console.log(builder.build(ctx).slice(0, 200) + '...');

  try { rmSync('.sessions-smoke', { recursive: true, force: true }); } catch {}
}

if (stage === '11') {
  console.log('\n=== s11: Microcompact ===\n');

  const msgs: ModelMessage[] = [
    { role: 'user', content: '帮我读 5 个文件' },
    toolMsg('read_file', 'A '.repeat(500)),
    toolMsg('read_file', 'B '.repeat(500)),
    toolMsg('read_file', 'C '.repeat(500)),
    toolMsg('read_file', 'D '.repeat(500)),
    toolMsg('read_file', 'E '.repeat(500)),
    { role: 'assistant', content: [{ type: 'text', text: '读完了' }] as any },
  ];

  const { messages, cleared } = microcompact(msgs);
  console.log(`microcompact: cleared=${cleared} 条（保留最近 3 条）`);
  const toolMsgs = messages.filter(m => m.role === 'tool');
  toolMsgs.forEach((m, i) => {
    const out = (m as any).content[0].output as string;
    console.log(`  tool[${i}]: ${out.startsWith('[') ? out : out.slice(0, 30) + '...'}`);
  });
}

if (stage === '12') {
  console.log('\n=== s12: Context Defense ===\n');

  const tracker = new TokenTracker();
  tracker.updateFromAPI(1000);
  tracker.addChars(2000);
  console.log(`TokenTracker estimate: ${tracker.estimate()} tokens (精确 1000 + 增量 2000 chars≈500)`);

  const msgs: ModelMessage[] = [
    { role: 'user', content: 'test defense' },
    toolMsg('read_file', 'X'.repeat(600_000)), // 超大单条
    toolMsg('read_file', 'Y'.repeat(100)),
  ];
  const result = applyDefense(msgs, new Map());
  console.log(`applyDefense: truncated=${result.truncated} compacted=${result.compacted} tokenEstimate=${result.tokenEstimate}`);
  const bigOut = (result.messages[1] as any).content[0].output as string;
  console.log(`  超大工具结果: ${bigOut.length} chars (原 600000 → 截断到 Head+Tail)`);
}

if (stage === '13') {
  console.log('\n=== s13: Cost Tracking ===\n');

  // OpenAI 格式归一化
  const openai = normalizeUsage({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 300 });
  console.log('normalizeUsage (OpenAI):');
  console.log(`  input=${openai.inputTokens} cacheRead=${openai.cacheReadTokens} output=${openai.outputTokens}`);

  // Anthropic 格式归一化
  const anthropic = normalizeUsage(
    { inputTokens: 1000, outputTokens: 200 },
    { anthropic: { cacheCreationInputTokens: 100, cacheReadInputTokens: 50 } }
  );
  console.log('normalizeUsage (Anthropic):');
  console.log(`  input=${anthropic.inputTokens} cacheWrite=${anthropic.cacheWriteTokens} cacheRead=${anthropic.cacheReadTokens}`);

  const usageTracker = new UsageTracker();
  usageTracker.record({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0 }, 'deepseek-chat');
  usageTracker.record({ inputTokens: 800, outputTokens: 150, cacheReadTokens: 300, cacheWriteTokens: 0 }, 'deepseek-chat');
  console.log('\n' + usageTracker.formatPanel());

  console.log('\nrenderContextMatrix:');
  const matrix = renderContextMatrix({
    systemChars: 2000, toolChars: 8000, messageChars: 5000,
    contextWindow: 200_000, modelName: 'deepseek-chat',
  });
  console.log(matrix);
}
