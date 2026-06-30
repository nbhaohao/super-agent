/**
 * s1 真实 LLM 冒烟：流式对话 + 记忆。需 .env 里的 DEEPSEEK_API_KEY（LLM_PROVIDER=deepseek）。
 * 跑：pnpm v:s1   验证：第二轮能引用第一轮说过的名字 → messages 历史确实回传了。
 */
import 'dotenv/config';
import type { ModelMessage } from 'ai';
import { createModel } from '../providers/registry.js';
import { streamChat } from '../core/chat.js';

const model = createModel();
const messages: ModelMessage[] = [];

async function main() {
  messages.push({ role: 'user', content: '你好，我叫小明，请用一句话介绍你自己。' });
  process.stdout.write('Assistant: ');
  await streamChat(model, messages);
  console.log();

  messages.push({ role: 'user', content: '我刚才说我叫什么名字？' });
  process.stdout.write('Assistant: ');
  await streamChat(model, messages);
  console.log('\n\n[验证] 上一句应当提到「小明」——说明对话历史被完整传回。');
}

main().catch((e) => { console.error(e); process.exit(1); });
