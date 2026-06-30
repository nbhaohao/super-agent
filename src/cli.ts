/**
 * 已就位（AI 生成）—— 终端 REPL 入口（胶水层，扫一眼即可）。
 *
 * m02 起 CLI 长出工具系统：ToolRegistry 统一注册内置工具 + tool_search + 模拟延迟工具，
 * 并尝试连一个 MCP Server（失败/无 token 自动降级 Mock）。每实现一关，对应能力就在这里点亮。
 * （未实现的关里调到该能力会抛 TODO——属于预期：先让本关测试变绿再回来体验。）
 */
import 'dotenv/config';
import { createInterface } from 'node:readline';
import type { ModelMessage } from 'ai';
import { createModel } from './providers/registry.js';
import { agentLoop, type BudgetState } from './core/agent-loop.js';
import { createLoopDetector } from './core/loop-detection.js';
import { ToolRegistry } from './tools/registry.js';
import { allTools, createToolSearchTool, simulatedDeferredTools } from './tools/builtin.js';
import { MCPClient, MockMCPClient } from './tools/mcp.js';
import { createLogger } from './obs/logger.js';

const BASE_SYSTEM = '你是 Super Agent，一个有工具调用能力的 AI 助手。需要时主动使用工具获取信息，不要编造数据。';

const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry)); // s9：元工具
registry.register(...simulatedDeferredTools()); // s9：模拟工具膨胀（默认延迟，不进 prompt）

const model = createModel();
const logger = createLogger();
const detector = createLoopDetector();
const messages: ModelMessage[] = [];
const budget: BudgetState = { used: 0, limit: 50000 };

async function connectMCP(): Promise<void> {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  try {
    const client = token
      ? new MCPClient('npx', ['-y', '@modelcontextprotocol/server-github'], { GITHUB_PERSONAL_ACCESS_TOKEN: token })
      : new MockMCPClient();
    const names = await registry.registerMCPServer('github', client);
    console.log(`  已注册 ${names.length} 个 ${token ? '' : 'Mock '}MCP 工具`);
  } catch (err) {
    console.log(`  MCP 连接跳过：${err instanceof Error ? err.message : err}`);
  }
}

function systemPrompt(): string {
  try {
    return BASE_SYSTEM + registry.getDeferredToolSummary(); // s9：把延迟工具清单附进 system
  } catch {
    return BASE_SYSTEM; // s9 未实现时退回基础 prompt
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask() {
  rl.question('\nYou: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'exit') {
      await registry.closeAllMCP().catch(() => {});
      console.log('Bye!');
      rl.close();
      return;
    }
    messages.push({ role: 'user', content: trimmed });
    process.stdout.write('Assistant: ');
    const result = await agentLoop(model, registry.toAISDKFormat(), messages, { system: systemPrompt(), budget, detector, logger });
    console.log(`\n  [stop: ${result.stoppedBy} · steps: ${result.steps} · tokens: ${budget.used}/${budget.limit}]`);
    ask();
  });
}

async function main() {
  await connectMCP();
  const active = registry.getActiveTools().length;
  console.log(`Super Agent v0.4 — Tool System（共 ${registry.getAll().length} 工具，活跃 ${active}）。输入 exit 退出`);
  console.log('试试："列一下当前目录"、"读 package.json"、"把 X 改成 Y"、"查 vercel/ai 的 issues"');
  ask();
}
main();
