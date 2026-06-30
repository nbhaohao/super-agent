/**
 * s2 真实 LLM 冒烟：Agent Loop 多步 + 工具调用。需 DEEPSEEK_API_KEY。
 * 跑：pnpm v:s2   验证：模型自己决定调 get_weather（可能并发两次），拿到结果后 Step 2 给对比，stop=final。
 */
import 'dotenv/config';
import type { ModelMessage } from 'ai';
import { createModel } from '../providers/registry.js';
import { agentLoop } from '../core/agent-loop.js';
import { tools } from '../tools/index.js';
import { createLogger } from '../obs/logger.js';

const model = createModel();
const messages: ModelMessage[] = [{ role: 'user', content: '北京和上海现在天气怎么样？哪个更适合出门？' }];

async function main() {
  process.stdout.write('Assistant: ');
  const r = await agentLoop(model, tools, messages, {
    system: '你是有工具能力的助手，需要数据时调用工具，不要编造。',
    logger: createLogger('debug'),
  });
  console.log(`\n\n[结果] stoppedBy=${r.stoppedBy} steps=${r.steps}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
