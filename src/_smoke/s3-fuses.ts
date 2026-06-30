/**
 * s3 机制冒烟：三层防护。用 mock（精确控制失败时机，无需 key）。
 * 跑：pnpm v:s3   验证：死循环被检测打断 / 429 自动重试后成功 / 预算超限强制停止。
 */
import type { ModelMessage } from 'ai';
import { createMockModel } from '../providers/mock-model.js';
import { agentLoop, type BudgetState } from '../core/agent-loop.js';
import { tools } from '../tools/index.js';
import { createLogger } from '../obs/logger.js';

const log = createLogger('debug');

async function run(label: string, content: string, extra: Parameters<typeof agentLoop>[3] = {}) {
  console.log(`\n===== ${label} =====`);
  const messages: ModelMessage[] = [{ role: 'user', content }];
  const r = await agentLoop(createMockModel(), tools, messages, { logger: log, maxSteps: 15, ...extra });
  console.log(`-> stoppedBy=${r.stoppedBy} steps=${r.steps}`);
}

async function main() {
  await run('① 循环检测', '测试死循环');                     // 期望 stoppedBy=loop_detected
  await run('② API 容错（重试）', '测试重试');                // mock 前两次抛 429，重试后成功 → final
  const budget: BudgetState = { used: 0, limit: 4000 };
  await run('③ Token 预算', '测试预算', { budget });          // 一步 4500 > 4000 → budget
}

main().catch((e) => { console.error(e); process.exit(1); });
