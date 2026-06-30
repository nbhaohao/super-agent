/**
 * s2 真实 LLM 冒烟（手动 REPL —— 你自己敲 prompt，不再注入预设台词）。
 * 需 .env 里的 DEEPSEEK_API_KEY（LLM_PROVIDER=deepseek）。
 *
 * 跑：pnpm v:s2
 * 试：问「北京和上海现在天气怎么样？哪个更适合出门？」——看模型自己决定调 get_weather
 *     （可能并发两次），拿到结果后下一步给对比、stoppedBy=final。换别的问题观察多步/工具选择。
 *     历史跨轮累积（同 s1），输入 exit 退出。
 */
import 'dotenv/config';
import { createInterface } from 'node:readline';
import type { ModelMessage } from 'ai';
import { createModel } from '../providers/registry.js';
import { agentLoop } from '../core/agent-loop.js';
import { tools } from '../tools/index.js';
import { createLogger } from '../obs/logger.js';

const SYSTEM = '你是有工具能力的助手，需要数据时调用工具，不要编造。';
const model = createModel();
const logger = createLogger('debug'); // debug 日志让每一步 think→act→observe 可见
const messages: ModelMessage[] = []; // 跨轮持续累积 = 记忆

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask() {
  rl.question('\nYou: ', async (input) => {
    const text = input.trim();
    if (!text || text === 'exit') { rl.close(); return; }
    messages.push({ role: 'user', content: text });
    process.stdout.write('Assistant: ');
    const r = await agentLoop(model, tools, messages, { system: SYSTEM, logger }); // ← 你写的循环在这跑
    console.log(`\n\n  [结果] stoppedBy=${r.stoppedBy} steps=${r.steps} · 历史 ${messages.length} 条`);
    ask();
  });
}

console.log('s2 手动冒烟 — 自己敲 prompt（试：北京和上海天气哪个更适合出门？）。exit 退出。');
ask();
