import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import { Conversation } from './conversation.js';
import { agentLoop } from './agent-loop.js';
import { log } from '../lib/logger.js';

export type { AgentStreamPart } from './agent-loop.js';

const SYSTEM_PROMPT = `你是 Super Agent，一个有工具调用能力的 AI 助手。
需要时主动使用工具获取信息，不要编造数据。`;

type Tools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

export class ChatAgent {
    private readonly conversation = new Conversation();

    constructor(
        private readonly model: LanguageModel,
        private readonly tools: Tools = {},
    ) {}

    async *chat(userInput: string) {
        log('chat() turn start', `history: ${this.conversation.getHistory().length} messages, tools: [${Object.keys(this.tools).join(', ')}]`);

        this.conversation.addUserMessage(userInput);

        const messages = [...this.conversation.getHistory()];
        const priorLength = messages.length;

        yield* agentLoop(this.model, this.tools, messages, SYSTEM_PROMPT);

        this.conversation.appendMessages(messages.slice(priorLength));
        log('turn complete', `history now: ${this.conversation.getHistory().length} messages`);
    }
}
