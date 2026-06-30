/**
 * 流式对话（s1 核心 · 你来写的「胶水/编排」件 —— write）。
 *
 * 这是本关唯一要你亲手写的编排逻辑：把流式回复接起来 + 维护对话历史。
 * 关键认知：模型本身无记忆，下一轮能「记住」全靠把整个 messages 再传回去。
 * 红测试规格：test/m01.test.ts → 「streamChat 回流文本并把 assistant 消息追加进历史」。
 */
import { streamText, type ModelMessage } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";

export interface ChatOptions {
  system?: string;
  /** 流式输出去处，默认 process.stdout。测试时可传一个收集器。 */
  out?: { write(s: string): void };
}

/**
 * 把一轮对话跑完：messages 末尾应已含本轮 user 消息；本函数流式产出 assistant 回复，
 * 追加 assistant 消息到 messages，并返回完整文本。
 */
export async function streamChat(
  model: LanguageModelV2,
  messages: ModelMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const out = options.out ?? process.stdout;
  const result = await streamText({ model, system: options.system, messages });
  let full = "";
  for await (const chunk of result.textStream) {
    out.write(chunk);
    full += chunk;
  }
  messages.push({ role: "assistant", content: full });
  return full;
}
