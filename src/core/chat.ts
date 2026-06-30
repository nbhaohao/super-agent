/**
 * 流式对话（s1 核心 · 后端核心，重点 review）。
 *
 * 三件事：① streamText 拿流式回复 ② 逐字写到 out（打字机效果）③ 把这轮 user+assistant
 * 追加进 messages 历史。关键认知：模型本身无记忆，下一轮能「记住」是因为 messages 整个传回去。
 */
import { streamText, type ModelMessage } from 'ai';
import type { LanguageModelV2 } from '@ai-sdk/provider';

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
  const result = streamText({ model, system: options.system, messages });

  let full = '';
  for await (const chunk of result.textStream) {
    out.write(chunk);
    full += chunk;
  }
  messages.push({ role: 'assistant', content: full });
  return full;
}
