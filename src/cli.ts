/**
 * 已就位（AI 生成）—— 终端 REPL 入口（胶水层，扫一眼即可）。
 *
 * m02 起 CLI 长出工具系统；m03 起长出上下文工程：
 *   s10 会话持久化（JSONL）+ 模块化 system prompt（PromptBuilder）
 *   s11 每轮 microcompact 清旧工具结果
 *   s12 每轮 applyDefense 防上下文爆窗
 *   s13 normalizeUsage 归一各厂商用量 + /context 看占用矩阵 + /usage 看花费与缓存节省
 * 每实现一关，对应能力就在这里点亮；未实现的关里调到该能力会抛 TODO——已用 try/catch 兜底降级，
 * 先让本关测试变绿再回来体验（pnpm agent）。
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import type { ModelMessage } from "ai";
import { createModel } from "./providers/registry.js";
import { agentLoop, type BudgetState } from "./core/agent-loop.js";
import { createLoopDetector } from "./core/loop-detection.js";
import { ToolRegistry } from "./tools/registry.js";
import {
  allTools,
  createToolSearchTool,
  simulatedDeferredTools,
} from "./tools/builtin.js";
import { MCPClient, MockMCPClient } from "./tools/mcp.js";
import { createLogger } from "./obs/logger.js";
// ── m03 上下文工程 ──
import { SessionStore } from "./context/session.js";
import {
  PromptBuilder,
  coreRules,
  toolGuide,
  deferredToolsHint,
  sessionContext,
} from "./context/prompt-pipe.js";
import { microcompact } from "./context/compaction.js";
import { applyDefense, estimateMessageTokens } from "./context/defense.js";
import { normalizeUsage, UsageTracker } from "./obs/cost.js";
import { renderContextMatrix } from "./context/view.js";

const BASE_SYSTEM =
  "你是 Super Agent，一个有工具调用能力的 AI 助手。需要时主动使用工具获取信息，不要编造数据。";
const MODEL_NAME = process.env.AGENT_MODEL ?? "deepseek-chat";

const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry)); // s9：元工具
registry.register(...simulatedDeferredTools()); // s9：模拟工具膨胀（默认延迟，不进 prompt）

const model = createModel();
const logger = createLogger();
const detector = createLoopDetector();
const budget: BudgetState = { used: 0, limit: 50000 };

// s10：会话持久化——启动即从 JSONL 恢复历史（进程重启不丢上下文）
const session = new SessionStore(process.env.AGENT_SESSION ?? "default");
const messages: ModelMessage[] = session.exists() ? session.load() : [];

// s13：用量统计——每步 normalizeUsage 后累计，/usage 看花费与缓存节省
const usageTracker = new UsageTracker();
const builder = new PromptBuilder()
  .pipe("rules", coreRules())
  .pipe("guide", toolGuide())
  .pipe("deferred", deferredToolsHint())
  .pipe("session", sessionContext());

async function connectMCP(): Promise<void> {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  try {
    const client = token
      ? new MCPClient("npx", ["-y", "@modelcontextprotocol/server-github"], {
          GITHUB_PERSONAL_ACCESS_TOKEN: token,
        })
      : new MockMCPClient();
    const names = await registry.registerMCPServer("github", client);
    console.log(`  已注册 ${names.length} 个 ${token ? "" : "Mock "}MCP 工具`);
  } catch (err) {
    console.log(`  MCP 连接跳过：${err instanceof Error ? err.message : err}`);
  }
}

// s10：用 PromptBuilder 组装；未实现时退回基础 prompt + s9 延迟工具清单
function systemPrompt(): string {
  try {
    return builder.build({
      toolCount: registry.getActiveTools().length,
      deferredToolSummary: registry.getDeferredToolSummary(),
      sessionMessageCount: messages.length,
      sessionId: process.env.AGENT_SESSION ?? "default",
    });
  } catch {
    try {
      return BASE_SYSTEM + registry.getDeferredToolSummary();
    } catch {
      return BASE_SYSTEM;
    }
  }
}

// s11 + s12：每轮发送前压缩 + 防线（任一关未实现则跳过那一步，不影响对话）
function squeezeContext(): void {
  try {
    const r = microcompact(messages);
    messages.length = 0;
    messages.push(...r.messages);
  } catch {}
  try {
    const r = applyDefense(messages);
    messages.length = 0;
    messages.push(...r.messages);
  } catch {}
}

// /context：上下文占用 16×16 矩阵
function printContext(): void {
  const sys = systemPrompt();
  const toolJson = JSON.stringify(registry.toAISDKFormat());
  try {
    console.log(
      renderContextMatrix({
        systemChars: sys.length,
        toolChars: toolJson.length,
        messageChars: messages.reduce(
          (s, m) => s + JSON.stringify(m.content).length,
          0,
        ),
        contextWindow: 200_000,
        modelName: MODEL_NAME,
      }),
    );
  } catch {
    console.log(`  /context 未就位（s12/s13），当前估算 ${estimateTokens()} tokens`);
  }
}

function estimateTokens(): number {
  try {
    return estimateMessageTokens(messages);
  } catch {
    return Math.ceil(
      messages.reduce((s, m) => s + JSON.stringify(m.content).length, 0) / 4,
    );
  }
}

// /usage：花费与缓存节省面板
function printUsage(): void {
  try {
    console.log(usageTracker.formatPanel());
  } catch {
    console.log("  /usage 未就位（s13 normalizeUsage 尚未实现）");
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask() {
  rl.question("\nYou: ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "exit") {
      await registry.closeAllMCP().catch(() => {});
      console.log("Bye!");
      rl.close();
      return;
    }
    if (trimmed === "/context") return printContext(), ask();
    if (trimmed === "/usage") return printUsage(), ask();

    const userMsg: ModelMessage = { role: "user", content: trimmed };
    messages.push(userMsg);
    session.append(userMsg); // s10：落盘

    squeezeContext(); // s11 + s12
    const before = messages.length;

    process.stdout.write("Assistant: ");
    const result = await agentLoop(model, registry.toAISDKFormat(), messages, {
      system: systemPrompt(),
      budget,
      detector,
      logger,
      onStep: (usage, meta) => {
        // s13：归一各厂商用量口径后累计；未实现则跳过
        try {
          usageTracker.record(normalizeUsage(usage, meta), MODEL_NAME);
        } catch {}
      },
    });

    session.appendAll(messages.slice(before)); // s10：本轮新增消息落盘
    console.log(
      `\n  [stop: ${result.stoppedBy} · steps: ${result.steps} · tokens: ${budget.used}/${budget.limit} · ctx≈${estimateTokens()} · /context /usage]`,
    );
    ask();
  });
}

async function main() {
  await connectMCP();
  const active = registry.getActiveTools().length;
  console.log(
    `Super Agent v0.5 — Context Engineering（共 ${registry.getAll().length} 工具，活跃 ${active}，历史 ${messages.length} 条）。输入 exit 退出`,
  );
  console.log(
    '试试："列一下当前目录"、"读 package.json"，或 /context 看占用、/usage 看花费',
  );
  ask();
}
main();
