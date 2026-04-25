import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import { Conversation } from '../domain/conversation.js';
import { agentLoop } from './agent-loop.js';
import { log } from '../lib/logger.js';

export type { AgentStreamPart } from './agent-loop.js';

const SYSTEM_PROMPT = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要查询信息时，主动使用工具，不要编造数据。
回答要简洁直接。`;

type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

export class ChatAgent {
    private readonly conversation = new Conversation();

    // tools 通过构造函数注入，应用层不直接依赖 infrastructure
    // 组合根（index.ts）负责传入具体的工具集合
    constructor(
        private readonly model: LanguageModel,
        private readonly tools: Tools = {},
    ) {}

    async *chat(userInput: string) {
        log('chat() turn start', `history: ${this.conversation.getHistory().length} messages, tools: [${Object.keys(this.tools).join(', ')}]`);

        this.conversation.addUserMessage(userInput);

        // agentLoop 接收可变数组，每一步会向其追加消息
        // 循环结束后，messages 包含完整的 tool-call / tool-result 链，我们同步回 conversation
        const messages = [...this.conversation.getHistory()];
        const priorLength = messages.length;

        yield* agentLoop(this.model, this.tools, messages, SYSTEM_PROMPT);

        // 同步 agentLoop 追加的所有消息（含 tool-call / tool-result / 最终回复）
        this.conversation.appendMessages(messages.slice(priorLength));
        log('turn complete', `history now: ${this.conversation.getHistory().length} messages`);
    }
}
