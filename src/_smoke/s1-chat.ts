/**
 * s1 真实 LLM 冒烟（手动 REPL —— 你自己敲 prompt，不再注入预设台词）。
 * 需 .env 里的 DEEPSEEK_API_KEY（LLM_PROVIDER=deepseek）；或 LLM_PROVIDER=mock 零 key 跑。
 *
 * 跑：pnpm v:s1
 * 验证记忆：先说「我叫小明」，再问「我叫什么名字」——第二轮能答出来，
 *           就证明 messages 历史被完整回传（模型本身无记忆）。输入 exit 退出。
 */
import 'dotenv/config';
import { createInterface } from 'node:readline';
import type { ModelMessage } from 'ai';
import { createModel } from '../providers/registry.js';
import { streamChat } from '../core/chat.js';

const SYSTEM = '你是 Super Agent，一个简洁、诚实的 AI 助手。';
const model = createModel();
const messages: ModelMessage[] = []; // 跨轮持续累积 = 记忆的全部秘密

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask() {
  rl.question('\nYou: ', async (input) => {
    const text = input.trim();
    if (!text || text === 'exit') { rl.close(); return; }
    messages.push({ role: 'user', content: text });
    process.stdout.write('Assistant: ');
    await streamChat(model, messages, { system: SYSTEM }); // ← 你写的胶水在这跑
    console.log(`\n  [历史 ${messages.length} 条 · 整段回传 = 它「记得住」的原因]`);
    ask();
  });
}

console.log('s1 手动冒烟 — 自己敲 prompt（试：先说名字，下一轮再问名字）。exit 退出。');
ask();
