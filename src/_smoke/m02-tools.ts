/**
 * m02 真实 LLM 冒烟（手动 REPL —— 你自己敲 prompt，debug 日志让 think→tool→observe 全程可见）。
 * 需 .env 里的 DEEPSEEK_API_KEY（LLM_PROVIDER=deepseek）。跑：pnpm v:s4 … pnpm v:s9
 *
 * 按关试不同 prompt：
 *   s4 工具/截断/并发：「列一下当前目录，再读 package.json」「同时查北京和上海天气」（看 [并发]/[串行] 与截断）
 *   s5 内置工具：「在 src 下 grep 一下 ToolRegistry」「把 README 里的 X 改成 Y」（edit_file 走独占锁）
 *   s6 组装应用：「找出项目里所有 TODO 并归类」「抓 https://example.com 做个摘要」
 *   s7 搜索：配好 TAVILY/SERPER 后「搜一下最新的 AI SDK 版本」
 *   s8 MCP：配 GITHUB_PERSONAL_ACCESS_TOKEN 后「查 vercel/ai 的 issues」（否则走 Mock）
 *   s9 延迟加载：「打开 notion 搜一下会议纪要」——看模型先 tool_search 再调用
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import type { ModelMessage } from "ai";
import { createModel } from "../providers/registry.js";
import { agentLoop } from "../core/agent-loop.js";
import { ToolRegistry } from "../tools/registry.js";
import {
  allTools,
  createToolSearchTool,
  simulatedDeferredTools,
} from "../tools/builtin.js";
import { MockMCPClient } from "../tools/mcp.js";
import { createLogger } from "../obs/logger.js";

const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry));
registry.register(...simulatedDeferredTools());

const model = createModel();
const logger = createLogger("debug"); // 每一步都打印，建立直觉
const messages: ModelMessage[] = [];

function systemPrompt(): string {
  try {
    return (
      "你是有工具能力的助手，需要数据/操作时调用工具，不要编造。" +
      registry.getDeferredToolSummary()
    );
  } catch {
    return "你是有工具能力的助手，需要数据/操作时调用工具，不要编造。";
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask() {
  rl.question("\nYou: ", async (input) => {
    const text = input.trim();
    if (!text || text === "exit") {
      await registry.closeAllMCP().catch(() => {});
      rl.close();
      return;
    }
    messages.push({ role: "user", content: text });
    process.stdout.write("Assistant: ");
    const r = await agentLoop(model, registry.toAISDKFormat(), messages, {
      system: systemPrompt(),
      logger,
    });
    console.log(
      `\n\n  [结果] stoppedBy=${r.stoppedBy} steps=${r.steps} · 历史 ${messages.length} 条`,
    );
    ask();
  });
}

async function main() {
  const mcp = await registry
    .registerMCPServer("github", new MockMCPClient())
    .catch(() => [] as string[]); // s8 未实现则跳过
  if (mcp.length) console.log(`已注册 ${mcp.length} 个 Mock MCP 工具`);
  console.log(
    `m02 手动冒烟 — 共 ${registry.getAll().length} 工具，活跃 ${registry.getActiveTools().length}。自己敲 prompt，exit 退出。`,
  );
  ask();
}
main();
