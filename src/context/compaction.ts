// 已就位（AI 生成）——上下文压缩：Layer 1 Microcompact + Layer 2 LLM 摘要
import { generateText } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";

// 可清理的工具（结果价值随时间衰减，清空后对模型影响小）
const CLEARABLE_TOOLS = new Set([
  "read_file",
  "list_directory",
  "fetch_url",
  "web_search",
  "mcp__github__list_issues",
  "mcp__github__get_file_contents",
]);
const KEEP_RECENT_TOOL_RESULTS = 3;

const COMPRESS_PROMPT = `你是对话历史压缩助手。将下面的对话历史压缩为简洁摘要，保留：
- 已完成的任务和结论
- 当前正在进行的任务状态
- 关键发现、决策和代码变更
- 用户明确表达的需求和偏好

输出格式（严格遵守，不超过 800 字）：
## 已完成
- [完成项]

## 当前状态
[当前正在做什么]

## 关键信息
- [关键信息]

## 用户偏好
- [偏好（如有）]`;

/**
 * s11 你写 —— Layer 1 Microcompact：把「旧的、可重取的」工具结果替换成占位符。
 *
 * 为什么：read_file/web_search 这类结果价值随时间衰减，模型早不看了却仍占 token。
 * 清空它们（保留消息结构，不删消息）几乎不影响推理，且零 LLM 成本（纯本地）。
 * 规则：① 只清 CLEARABLE_TOOLS 里的工具 ② 保留最近 KEEP_RECENT_TOOL_RESULTS 条（可能还要用）。
 * 把被清结果的 output 换成 '[tool result cleared]'，cleared 计被清条数。
 */
export function microcompact(messages: ModelMessage[]): {
  messages: ModelMessage[];
  cleared: number;
} {
  //  stage s11
  // 1. 扫一遍 messages，收集所有 role==='tool' 的索引
  // 2. 算出「该清理」的索引集合 = 除最近 KEEP_RECENT_TOOL_RESULTS 条外的旧 tool 消息
  // 3. map messages：命中且其 tool-result 的 toolName 在 CLEARABLE_TOOLS 里 → output 改 '[tool result cleared]'，cleared++
  //    （不在 CLEARABLE_TOOLS 的工具结果保持原样，如 edit_file）
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") {
      toolIndices.push(i);
    }
  }
  // 除最近 KEEP_RECENT_TOOL_RESULTS 条外，其余是旧结果
  const clearSet = new Set(toolIndices.slice(0, -KEEP_RECENT_TOOL_RESULTS));

  let cleared = 0;
  const newMessages = messages.map((msg: ModelMessage, i) => {
    if (msg.role === "tool" && clearSet.has(i) && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-result" && CLEARABLE_TOOLS.has(part.toolName)) {
          part.output = "[tool result cleared]";
          cleared++;
        }
      }
    }
    return msg;
  });
  return { messages: newMessages, cleared };
}

function messagesToText(messages: ModelMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === "user") {
        const c = msg.content;
        return `User: ${typeof c === "string" ? c : JSON.stringify(c)}`;
      }
      if (msg.role === "assistant") {
        const parts = Array.isArray(msg.content) ? (msg.content as any[]) : [];
        const text = parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("");
        return `Assistant: ${text || "[tool calls]"}`;
      }
      if (msg.role === "tool") return `Tool: [results]`;
      return `[${(msg as any).role}]`;
    })
    .join("\n");
}

// 切分点对齐到 user 消息边界，避免 API 要求"messages 不得以 tool/assistant 开头"
function alignToUserBoundary(messages: ModelMessage[], idx: number): number {
  for (let i = idx; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return 0;
}

export interface SummarizeResult {
  messages: ModelMessage[];
  summary: string;
  compressedCount: number;
}

// Layer 2：LLM 摘要（有损，历史不可恢复——先跑 Layer 1 再考虑 Layer 2）
export async function summarize(
  model: LanguageModelV2,
  messages: ModelMessage[],
  keepRecent: number = 6,
  existingSummary?: string,
): Promise<SummarizeResult> {
  if (messages.length <= keepRecent) {
    return { messages, summary: existingSummary ?? "", compressedCount: 0 };
  }

  const splitAt = alignToUserBoundary(
    messages,
    messages.length - keepRecent - 1,
  );
  const toCompress = messages.slice(0, splitAt);
  const toKeep = messages.slice(splitAt);

  if (toCompress.length === 0) {
    return { messages, summary: existingSummary ?? "", compressedCount: 0 };
  }

  const prefix = existingSummary
    ? `## 之前的摘要\n${existingSummary}\n\n## 新增对话\n`
    : "";

  const { text: newSummary } = await generateText({
    model: model as any, // ponytail: AI SDK v5 LanguageModelV2 → generateText 类型对接
    system: COMPRESS_PROMPT,
    prompt: prefix + messagesToText(toCompress),
  });

  const summaryMessage: ModelMessage = {
    role: "user",
    content: `[系统摘要] 之前的对话已压缩，以下为摘要，请以此为上下文继续任务：\n\n${newSummary}`,
  };

  return {
    messages: [summaryMessage, ...toKeep],
    summary: newSummary,
    compressedCount: toCompress.length,
  };
}
