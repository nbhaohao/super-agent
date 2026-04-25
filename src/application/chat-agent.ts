import { streamText, stepCountIs } from 'ai';
import type { LanguageModel } from 'ai';
import { Conversation } from '../domain/conversation.js';
import { log } from '../lib/logger.js';

const SYSTEM_PROMPT = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要时主动使用工具获取信息，不要编造数据。`;

// 使用 streamText 参数类型推导 Tools，避免手动维护重复的类型定义
type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

// AgentStreamPart 是应用层与 CLI 层之间的契约
// CLI 层只需处理这三种情况，不需要关心 AI SDK 的内部类型
export type AgentStreamPart =
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolName: string; input: unknown }
    | { type: 'tool-result'; toolName: string; output: unknown };

export class ChatAgent {
    private readonly conversation = new Conversation();

    // tools 通过构造函数注入，应用层不直接依赖 infrastructure
    // 组合根（index.ts）负责传入具体的工具集合
    constructor(
        private readonly model: LanguageModel,
        private readonly tools: Tools = {},
    ) {}

    async *chat(userInput: string): AsyncGenerator<AgentStreamPart> {
        const history = this.conversation.getHistory();
        log('chat() turn start', `history: ${history.length} messages, tools: [${Object.keys(this.tools).join(', ')}]`);

        this.conversation.addUserMessage(userInput);

        // streamText 发出去的完整 payload：messages（含历史）+ system prompt + tools
        // 每一轮都把完整历史传给 LLM，这就是"记忆"的实现方式
        log('streamText →', `${history.length + 1} messages → LLM`);

        const result = streamText({
            model: this.model,
            messages: [...this.conversation.getHistory()],
            system: SYSTEM_PROMPT,
            tools: this.tools,
            stopWhen: stepCountIs(5), // 防止 agent 无限循环调用工具
        });

        let fullResponse = '';
        let stepCount = 0;

        for await (const part of result.fullStream) {
            switch (part.type) {
                case 'text-delta':
                    if (fullResponse === '') log('LLM started responding');
                    fullResponse += part.text;
                    yield { type: 'text', text: part.text };
                    break;

                case 'tool-call':
                    stepCount++;
                    // tool-call 和 tool-result 成对出现，共同构成一个 agent step
                    // LLM 决定调用哪个工具、传什么参数
                    log(`step ${stepCount} tool-call`, `${part.toolName}(${JSON.stringify(part.input)})`);
                    yield { type: 'tool-call', toolName: part.toolName, input: part.input };
                    break;

                case 'tool-result':
                    // 工具执行结果会作为新消息追加到 messages，LLM 再次调用时能看到
                    log(`step ${stepCount} tool-result`, `${part.toolName} → ${JSON.stringify(part.output)}`);
                    yield { type: 'tool-result', toolName: part.toolName, output: part.output };
                    break;
            }
        }

        this.conversation.addAssistantMessage(fullResponse);
        log('turn complete', `response: ${fullResponse.length} chars | history now: ${this.conversation.getHistory().length} messages`);
    }
}
