/**
 * 已就位（AI 生成）—— 终端 REPL 入口（胶水层，扫一眼即可）。
 * 把 registry + agentLoop + 工具 + 跨轮预算 串起来：读一行 → 跑 Agent Loop → 再读一行。
 */
import 'dotenv/config';
import { createInterface } from 'node:readline';
import type { ModelMessage } from 'ai';
import { createModel } from './providers/registry.js';
import { agentLoop, type BudgetState } from './core/agent-loop.js';
import { createLoopDetector } from './core/loop-detection.js';
import { tools } from './tools/index.js';
import { createLogger } from './obs/logger.js';

const SYSTEM = '你是 Super Agent，一个有工具调用能力的 AI 助手。需要时主动使用工具获取信息，不要编造数据。';

const model = createModel();
const logger = createLogger();
const detector = createLoopDetector();
const messages: ModelMessage[] = [];
const budget: BudgetState = { used: 0, limit: 50000 }; // 跨轮持续累计

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask() {
  rl.question('\nYou: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'exit') {
      console.log('Bye!');
      rl.close();
      return;
    }
    messages.push({ role: 'user', content: trimmed });
    process.stdout.write('Assistant: ');
    const result = await agentLoop(model, tools, messages, { system: SYSTEM, budget, detector, logger });
    console.log(`\n  [stop: ${result.stoppedBy} · steps: ${result.steps} · tokens: ${budget.used}/${budget.limit}]`);
    ask();
  });
}

console.log('Super Agent v0.3 — Agent Loop + Fuses (type "exit" to quit)');
console.log('试试："北京天气怎么样"、"测试死循环"、"测试预算"');
ask();
