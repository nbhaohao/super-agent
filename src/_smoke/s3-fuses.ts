/**
 * s3 机制冒烟：三层防护。你来选要点哪根「保险丝」，mock 负责精确制造失败时机。
 * 用 mock（无需 key）——429／死循环／超预算这类失败靠自然 prompt 触发不了，必须由替身在确定时机注入。
 *
 * 跑：pnpm v:s3   选 1/2/3 观察：死循环被检测打断 / 429 自动重试后成功 / 预算超限强制停止。
 */
import { createInterface } from 'node:readline';
import type { ModelMessage } from 'ai';
import { createMockModel } from '../providers/mock-model.js';
import { agentLoop, type BudgetState } from '../core/agent-loop.js';
import { tools } from '../tools/index.js';
import { createLogger } from '../obs/logger.js';

const log = createLogger('debug');

// 每个保险丝：触发它的 mock 关键词 content + 期望停因（注入时机在 mock-model.ts 的 decide()）
const FUSES = {
  '1': { label: '① 循环检测', content: '测试死循环', expect: 'loop_detected', extra: {} as Parameters<typeof agentLoop>[3] },
  '2': { label: '② API 容错（重试）', content: '测试重试', expect: 'final', extra: {} },
  '3': { label: '③ Token 预算', content: '测试预算', expect: 'budget', extra: { budget: { used: 0, limit: 4000 } satisfies BudgetState } },
} as const;

async function fire(key: keyof typeof FUSES) {
  const f = FUSES[key];
  console.log(`\n===== ${f.label}（期望 stoppedBy=${f.expect}）=====`);
  const messages: ModelMessage[] = [{ role: 'user', content: f.content }];
  const r = await agentLoop(createMockModel(), tools, messages, { logger: log, maxSteps: 15, ...f.extra });
  console.log(`-> stoppedBy=${r.stoppedBy} steps=${r.steps}  ${r.stoppedBy === f.expect ? '✅ 符合预期' : '❌ 不符'}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function menu() {
  rl.question('\n选保险丝 [1] 循环检测  [2] 重试  [3] 预算 （exit 退出）: ', async (input) => {
    const key = input.trim();
    if (key === 'exit' || !key) { rl.close(); return; }
    if (key in FUSES) await fire(key as keyof typeof FUSES);
    else console.log('无效选项，输入 1 / 2 / 3。');
    menu();
  });
}

console.log('s3 三层防护冒烟 — 你选要点哪根保险丝，mock 负责制造失败。');
menu();
